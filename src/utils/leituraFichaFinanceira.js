/*
  Leitura de PDFs para o módulo de Retroativos PCCR — ficha financeira do
  servidor e tabela de níveis/categorias do PCS.

  IMPORTANTE — leia antes de confiar cegamente no resultado:
  - Os arquivos são processados só em memória, na hora da requisição — nunca
    são salvos em disco nem no banco de dados.
  - Só funciona de verdade com PDFs que tenham TEXTO real (gerados direto pelo
    sistema de folha, não escaneados/fotografados). Testamos com um PDF
    escaneado de exemplo e confirmamos que ele NÃO tem nenhum texto por trás —
    só imagem. Para esse tipo de arquivo, OCR seria necessário, mas isso exige
    programas (Tesseract, Poppler) que não estão instalados no servidor de
    produção (Render) — instalar isso pediria uma mudança maior de
    infraestrutura, e mesmo com OCR, já vimos neste mesmo sistema que os
    dígitos podem sair errados, o que é arriscado demais para um cálculo
    financeiro. Por isso, PDFs escaneados são recusados com um aviso claro.
  - A extração é "melhor esforço": o formato de ficha financeira varia entre
    prefeituras. Sempre revise os valores extraídos na tela antes de calcular
    — o sistema pré-preenche os campos de edição manual, não calcula direto.
*/

const { PDFParse } = require('pdf-parse');

async function extrairTextoPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const resultado = await parser.getText();
    return resultado.text || '';
  } finally {
    await parser.destroy();
  }
}

async function extrairTabelasPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const resultado = await parser.getTable();
    // achata as tabelas de todas as páginas numa lista única de "linhas" (cada linha é um array de células)
    const linhas = [];
    for (const pagina of resultado.pages || []) {
      for (const tabela of pagina.tables || []) {
        for (const linha of tabela) linhas.push(linha);
      }
    }
    return linhas;
  } finally {
    await parser.destroy();
  }
}

/**
 * Nem todo PDF tem uma "tabela" reconhecível pelo detector de tabelas (ex:
 * recibos de pagamento simples, sem linhas de grade explícitas) — mas o texto
 * dele quase sempre vem separado por tabulações entre colunas. Esta função
 * transforma esse texto em linhas de "células", no mesmo formato que as
 * funções de parse já esperam, sem precisar de tabela detectada.
 */
function linhasDeTextoTabulado(texto) {
  return texto
    .split(/\r?\n/)
    .map((linha) => linha.split('\t').map((c) => c.trim()).filter((c, i, arr) => !(c === '' && arr.length === 1)))
    .filter((celulas) => celulas.length > 1 || (celulas.length === 1 && celulas[0]));
}

/**
 * Variante para tabelas de nível/classe onde as colunas são separadas só por
 * espaço simples (não tabulação) — ex: "A B (5%) C (15%) D (20%)" ou
 * "2 1.322,70 1.388,83 1.597,15 1.916,59". Tokeniza reconhecendo números
 * monetários, letras de nível (com ou sem o percentual entre parênteses) e
 * números de classe, e trata linhas de subgrupo (sem nenhum desses padrões,
 * mas com uma sigla curta) como uma única célula.
 */
function linhasDeTextoEspacado(texto) {
  const regexToken = /[A-D]\s*\(\d{1,3}%?\)|-?\d{1,3}(?:\.\d{3})*,\d{2}|\b\d{1,2}\b|\b[A-D]\b/g;
  return texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha) => {
      // Linhas de "carga horária" (ex: "CARGA HORÁRIA DE 30 HORAS") precisam
      // ficar inteiras como rótulo — senão o tokenizador capturaria só o "30"
      // e perderíamos a distinção entre a tabela de 30h e a de 40h.
      if (/CARGA\s*HOR[AÁ]RIA/i.test(linha)) return [linha];
      const tokens = [...linha.matchAll(regexToken)].map((m) => m[0].trim());
      if (tokens.length >= 1) return tokens;
      return [linha]; // não bateu nenhum padrão numérico/nível — trata a linha inteira como um rótulo (ex: subgrupo)
    });
}

function pdfPareceEscaneado(texto) {
  // Um PDF com texto de verdade tem algum texto extraído; um PDF escaneado (só
  // imagem) devolve pouquíssimo ou nenhum. Limite propositalmente baixo (60
  // caracteres) para não recusar por engano documentos pequenos e legítimos
  // (ex: uma tabela de níveis com só 1-2 subgrupos).
  return texto.replace(/\s/g, '').length < 60;
}

function paraNumero(str) {
  if (!str) return null;
  const s = String(str).trim();
  let limpo;
  if (s.includes(',')) {
    // Formato brasileiro: ponto é separador de milhar, vírgula é decimal (ex: "1.234,56")
    limpo = s.replace(/\./g, '').replace(',', '.');
  } else {
    // Sem vírgula: o ponto (se houver) já é o separador decimal (ex: percentuais como "17.00")
    limpo = s;
  }
  const n = parseFloat(limpo);
  return Number.isNaN(n) ? null : n;
}

// Nomes de verbas que reconhecemos especificamente (além do salário-base).
// Qualquer outra linha de "Provento" com um padrão percentual+valor também é
// capturada genericamente, usando o próprio nome do evento como rótulo.
const VERBAS_CONHECIDAS = ['ANUENIO', 'ANUÊNIO', 'INSALUBRIDADE', 'PERICULOSIDADE', 'GRATIFICA', 'ADICIONAL'];

// Cada campo reconhecido: um "identificador" (regex do rótulo do evento, mais
// específico primeiro para não confundir, por exemplo, "13º SALÁRIO" comum com
// "AJUSTE 13º SALÁRIO"), e o "tipo": se a linha traz percentual+valor por mês
// (comum em proventos) ou só um valor por mês (comum em descontos/totais).
const CAMPOS_FICHA_FINANCEIRA = [
  { chave: 'fundoPrevidencia13', label: 'Fundo de Previdência (13º salário)', regex: /FUNDO.*PREVID[EÊ]NCIA.*13/, tipo: 'percentual_valor' },
  { chave: 'fundoPrevidencia', label: 'Fundo de Previdência', regex: /FUNDO.*PREVID[EÊ]NCIA/, tipo: 'percentual_valor' },
  { chave: 'irrf13', label: 'IRRF (13º salário)', regex: /I\.?\s*R\.?\s*R\.?\s*F\..*13/, tipo: 'percentual_valor' },
  { chave: 'irrf', label: 'IRRF', regex: /I\.?\s*R\.?\s*R\.?\s*F\./, tipo: 'percentual_valor' },
  { chave: 'decimoTerceiroAdiantado', label: '13º salário adiantado', regex: /13.?\s*SAL[AÁ]RIO\s*ADIANTADO/, tipo: 'percentual_valor' },
  { chave: 'decimoTerceiro', label: '13º salário', regex: /^25\s*-|^\d+\s*-\s*13.?\s*SAL[AÁ]RIO\s*$|^13.?\s*SAL[AÁ]RIO\b/, tipo: 'valor_unico' },
  { chave: 'insalubridade13', label: 'Insalubridade (13º salário)', regex: /INSALUBRIDADE.*13/, tipo: 'valor_unico' },
  { chave: 'insalubridade', label: 'Insalubridade', regex: /INSALUBRIDADE/, tipo: 'percentual_valor' },
  { chave: 'anuenio13', label: 'Anuênio (13º salário)', regex: /ANU[EÊ]NIO.*13/, tipo: 'valor_unico' },
  { chave: 'anuenio', label: 'Anuênio', regex: /ANU[EÊ]NIO|ANUENIO/, tipo: 'percentual_valor' },
  { chave: 'tercoFerias', label: '1/3 de férias', regex: /1\/3\s*F[EÉ]RIAS/, tipo: 'percentual_valor' },
  { chave: 'sindicato', label: 'Sindicato', regex: /SINDSMUJE|SINDICATO/, tipo: 'percentual_valor' },
  { chave: 'salarioBase', label: 'Salário base', regex: /SALARIO\s*BASE|VENCIMENTO\s*BASE/, tipo: 'valor_unico' },
  { chave: 'totalProventos', label: 'Total de proventos', regex: /TOTAL\s*PROVENTOS/, tipo: 'valor_unico' },
  { chave: 'totalDescontos', label: 'Total de descontos', regex: /TOTAL\s*DESCONTOS/, tipo: 'valor_unico' },
  { chave: 'totalLiquido', label: 'Total líquido', regex: /TOTAL\s*L[IÍ]QUIDO/, tipo: 'valor_unico' },
  // Outras verbas percentuais não previstas acima ainda são capturadas
  // genericamente (ver VERBAS_CONHECIDAS), para não perder informação.
];

// ---- Leitura COMPLETA da ficha: todas as rubricas (proventos e descontos), mês a mês ----

// Linhas que NÃO são rubricas (totais, cabeçalhos, bases de cálculo...).
const REGEX_LINHA_NAO_RUBRICA = /^TOTAL|TOTAL\s*(DE\s*)?(PROVENTOS|DESCONTOS|L[IÍ]QUIDO)|L[IÍ]QUIDO|BASE\s*(DE)?\s*C[AÁ]LCULO|MARGEM|COMPET[EÊ]NCIA|MATR[IÍ]CULA|P[AÁ]GINA|^NOME\b|^CARGO\b|^FUN[CÇ][AÃ]O\b|^LOTA[CÇ][AÃ]O/;
// Nomes que indicam DESCONTO/retenção quando a ficha não separa em seções.
const REGEX_DESCONTO = /INSS|PREVID[EÊ]NCIA|\bRPPS\b|\bRGPS\b|I\.?\s*R\.?\s*R\.?\s*F|IMPOSTO\s*DE\s*RENDA|SIND(ICATO|SMUJE|\b)|CONTRIB|EMPR[EÉ]STIMO|CONSIGN|\bFALTA|DESCONTO|PENS[AÃ]O\s*ALIM|MENSALIDADE|ADIANTAMENTO\s*DE|DEVOLU[CÇ][AÃ]O|PLANO\s*DE\s*SA[UÚ]DE|CAIXA\s*ESCOLAR|\bREPOSI[CÇ][AÃ]O/;
// Rubricas percentuais que NÃO acompanham o salário-base (não entram como "verba sobre o base").
const REGEX_NAO_ACOMPANHA_BASE = /13|1\/3|F[EÉ]RIAS|ADIANTAD|AJUSTE|RETROATIV|DIFEREN[CÇ]A|REFLEXO|PROPORCIONAL/;

function limparNomeRubrica(texto) {
  return String(texto || '').replace(/^\d+\s*[-–]\s*/, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Lê UMA linha da ficha como rubrica (provento ou desconto) para cada mês das
 * colunas atuais — incluindo as que não conhecemos pelo nome (gratificações,
 * abonos, diferenças, empréstimos...). Respeita as colunas vazias (um abono que
 * só aparece em alguns meses fica só nesses meses). Devolve null se a linha
 * não parece uma rubrica.
 */
function lerRubricaDaLinha(rotuloBruto, valoresCelulas, nCols, secao) {
  const nome = limparNomeRubrica(rotuloBruto);
  if (!nome || !/[A-Za-zÀ-ú]/.test(nome)) return null;
  if (REGEX_LINHA_NAO_RUBRICA.test(nome.toUpperCase())) return null;
  const numeros = valoresCelulas.map(paraNumero); // null = coluna vazia (mantém a posição)
  if (!numeros.some((n) => n != null)) return null;

  let porColuna = null; // [{percentual, valor}] na ordem das colunas
  if (numeros.length >= 2 * nCols) {
    const pares = [];
    let pareceParesPercentuais = true;
    for (let i = 0; i < nCols; i++) {
      const pct = numeros[i * 2], val = numeros[i * 2 + 1];
      if (pct != null && pct > 100) pareceParesPercentuais = false;
      pares.push({ percentual: pct != null && pct <= 100 ? pct : null, valor: val });
    }
    if (pareceParesPercentuais) porColuna = pares;
  }
  if (!porColuna && numeros.length >= nCols) {
    porColuna = numeros.slice(0, nCols).map((valor) => ({ percentual: null, valor }));
  }
  if (!porColuna) return null;

  const tipo = secao || (REGEX_DESCONTO.test(nome.toUpperCase()) ? 'desconto' : 'provento');
  return { nome, tipo, porColuna };
}

/**
 * Extrai, de linhas de tabela (uma linha = array de células, como devolvido
 * por getTable()), uma lista de {competencia, ...todosOsCamposReconhecidos}
 * por mês. Best-effort — sempre revisar antes de usar.
 */
function parseFichaFinanceiraDeTabelas(linhasTabela) {
  const resultado = new Map(); // 'aaaa-mm' -> { campos: {chave: valor}, verbasExtras: Map(nome->percentual) }
  let competenciasAtuais = []; // [{mm, aaaa}], na ordem das colunas desta tabela/bloco
  let secaoAtual = null; // 'provento' | 'desconto' | null — quando a ficha separa em seções

  const regexCompetencia = /^(\d{2})\/(\d{4})-\d+$/;

  for (const linha of linhasTabela) {
    if (!Array.isArray(linha) || !linha.length) continue;
    const celulas = linha.map((c) => (c == null ? '' : String(c).trim()));

    const competenciasNaLinha = celulas
      .map((c) => c.match(regexCompetencia))
      .filter(Boolean)
      .map((m) => ({ mm: m[1], aaaa: m[2] }));
    if (competenciasNaLinha.length >= 2) {
      competenciasAtuais = competenciasNaLinha;
      competenciasAtuais.forEach(({ mm, aaaa }) => {
        const chave = `${aaaa}-${mm}`;
        if (!resultado.has(chave)) resultado.set(chave, { campos: {}, verbasExtras: new Map(), rubricas: [] });
      });
      continue;
    }
    if (!competenciasAtuais.length) continue;

    // Quando a 1ª célula é só o CÓDIGO da rubrica (ex: "0001") e a descrição vem na 2ª, desloca.
    let celulasLinha = celulas;
    if (/^\d{1,5}$/.test(celulas[0]) && celulas[1] && /[A-Za-zÀ-ú]/.test(celulas[1])) celulasLinha = celulas.slice(1);

    // Cabeçalhos de seção ("PROVENTOS", "DESCONTOS"), quando a ficha separa assim.
    const textoSecao = celulasLinha[0].toUpperCase().replace(/[^A-ZÀ-Ú ]/g, '').trim();
    if (celulasLinha.slice(1).every((c) => !c)) {
      if (/^(PROVENTOS|VENCIMENTOS|VANTAGENS)$/.test(textoSecao)) { secaoAtual = 'provento'; continue; }
      if (/^(DESCONTOS|DEDU[CÇ][OÕ]ES|RETEN[CÇ][OÕ]ES)$/.test(textoSecao)) { secaoAtual = 'desconto'; continue; }
    }

    // Leitura completa: TODA rubrica com valores, conhecida ou não.
    const rubrica = lerRubricaDaLinha(celulasLinha[0], celulasLinha.slice(1), competenciasAtuais.length, secaoAtual);
    if (rubrica) {
      competenciasAtuais.forEach(({ mm, aaaa }, idx) => {
        const dado = rubrica.porColuna[idx];
        if (!dado || dado.valor == null || dado.valor === 0) return;
        resultado.get(`${aaaa}-${mm}`).rubricas.push({ nome: rubrica.nome, tipo: rubrica.tipo, percentual: dado.percentual, valor: dado.valor });
      });
    }

    const rotulo = celulasLinha[0].toUpperCase();
    const campoReconhecido = CAMPOS_FICHA_FINANCEIRA.find((c) => c.regex.test(rotulo));
    const verbaConhecida = !campoReconhecido && VERBAS_CONHECIDAS.find((v) => rotulo.includes(v));
    if (!campoReconhecido && !verbaConhecida) continue;

    const numeros = celulasLinha.slice(1).map(paraNumero).filter((n) => n != null);
    if (!numeros.length) continue;

    // Com a leitura posicional (que respeita colunas vazias), os campos conhecidos
    // também saem alinhados por mês — evita deslocar valores quando uma rubrica
    // só aparece em alguns meses.
    if (rubrica && campoReconhecido) {
      competenciasAtuais.forEach(({ mm, aaaa }, idx) => {
        const dado = rubrica.porColuna[idx];
        if (!dado || dado.valor == null) return;
        const campos = resultado.get(`${aaaa}-${mm}`).campos;
        campos[campoReconhecido.chave] = dado.valor;
        if (campoReconhecido.tipo !== 'valor_unico' && dado.percentual != null) campos[campoReconhecido.chave + 'Percentual'] = dado.percentual;
      });
      continue;
    }
    // Verbas "genéricas" já são cobertas pelas rubricas lidas acima.
    if (rubrica && !campoReconhecido) continue;

    if (campoReconhecido?.tipo === 'valor_unico') {
      competenciasAtuais.forEach(({ mm, aaaa }, idx) => {
        const chave = `${aaaa}-${mm}`;
        if (numeros[idx] != null) resultado.get(chave).campos[campoReconhecido.chave] = numeros[idx];
      });
    } else if (campoReconhecido) {
      // percentual_valor: 2 números por competência (percentual, valor) — guardamos os dois
      competenciasAtuais.forEach(({ mm, aaaa }, idx) => {
        const chave = `${aaaa}-${mm}`;
        const percentual = numeros[idx * 2];
        const valor = numeros[idx * 2 + 1];
        if (percentual != null && percentual <= 100) resultado.get(chave).campos[campoReconhecido.chave + 'Percentual'] = percentual;
        if (valor != null) resultado.get(chave).campos[campoReconhecido.chave] = valor;
      });
    } else if (verbaConhecida) {
      const nomeCompleto = celulasLinha[0].replace(/^\d+\s*-\s*/, '').trim() || verbaConhecida;
      competenciasAtuais.forEach(({ mm, aaaa }, idx) => {
        const chave = `${aaaa}-${mm}`;
        const percentual = numeros[idx * 2];
        if (percentual != null && percentual <= 100) resultado.get(chave).verbasExtras.set(nomeCompleto, percentual);
      });
    }
  }

  const meses = [...resultado.entries()]
    .filter(([, v]) => v.campos.salarioBase != null)
    .map(([competencia, v]) => {
      // Verbas percentuais que acompanham o salário-base (anuênio, insalubridade,
      // gratificações em %...): vêm de TODAS as rubricas de provento com percentual
      // lido no mês — mês a mês, então o que entra e sai esporadicamente fica certo.
      const verbas = new Map(v.verbasExtras);
      v.rubricas.forEach((r) => {
        if (r.tipo !== 'provento' || r.percentual == null || r.percentual <= 0) return;
        if (/SAL[AÁ]RIO\s*BASE|VENCIMENTO\s*BASE/i.test(r.nome) || REGEX_NAO_ACOMPANHA_BASE.test(r.nome.toUpperCase())) return;
        if (!verbas.has(r.nome)) verbas.set(r.nome, r.percentual);
      });
      return {
        competencia,
        basePago: v.campos.salarioBase,
        ...v.campos,
        verbasPercentuais: [...verbas.entries()].map(([nome, percentual]) => ({ nome, percentual })),
        rubricas: v.rubricas,
        totalProventosRubricas: v.rubricas.filter((r) => r.tipo === 'provento').reduce((a, r) => a + r.valor, 0),
        totalDescontosRubricas: v.rubricas.filter((r) => r.tipo === 'desconto').reduce((a, r) => a + r.valor, 0),
      };
    })
    .map((m) => {
      // Conferência: a soma das rubricas lidas precisa bater com o total impresso na ficha.
      // Se não bater, alguma rubrica deixou de ser lida (ou foi classificada no lado errado).
      const confere = (lido, impresso) => (impresso == null ? null : Math.abs(lido - impresso) < 0.05);
      return { ...m, conferencia: { proventos: confere(m.totalProventosRubricas, m.totalProventos), descontos: confere(m.totalDescontosRubricas, m.totalDescontos) } };
    })
    .sort((a, b) => a.competencia.localeCompare(b.competencia));
  return meses;
}

/**
 * Leitura da "FICHA FINANCEIRA COMPLETA - SINTÉTICA" a partir do TEXTO do PDF
 * (formato do sistema de gestão de pessoas da prefeitura): blocos de 4 meses
 * ("Eventos Tipo 01/2020-1 02/2020-1 ..."), uma linha por evento no formato
 * "<código> - <NOME> <Provento|Desconto|Retenções> <ref> <valor> ..." — com
 * "----" (um só traço) nos meses em que o evento não ocorreu. A tabela detectada
 * pelo PDF não serve aqui (ela omite linhas), por isso a leitura é pelo texto.
 * Os blocos podem ser interrompidos por quebra de página — o cabeçalho de meses
 * continua valendo até aparecer o próximo "Eventos Tipo".
 * Devolve null se o texto não tem esse formato.
 */
const REGEX_EVENTO_TEXTO = /^(\d+)\s*-\s*(.+?)\s+(Provento|Desconto|Reten[cç][oõ]es)\s+(.+)$/i;
const REGEX_NAO_E_PERCENTUAL = /SAL[AÁ]RIO\s*BASE|HORAS|DIAS\s*TRABALHADOS/i;

function tokensDoMes(tokens, nCols) {
  // Cada mês ocupa "----" (vazio) OU dois tokens (referência, valor).
  const porMes = [];
  let i = 0;
  for (let c = 0; c < nCols; c++) {
    if (i >= tokens.length) return null;
    if (/^-+$/.test(tokens[i])) { porMes.push(null); i += 1; continue; }
    if (i + 1 >= tokens.length) return null;
    porMes.push({ referencia: paraNumero(tokens[i]), valor: paraNumero(tokens[i + 1]) });
    i += 2;
  }
  return i === tokens.length ? porMes : null;
}

function parseFichaFinanceiraDeTexto(texto) {
  const linhas = String(texto || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const meses = new Map(); // 'aaaa-mm' -> { rubricas: [], totais: {} }
  let colunas = []; // chaves 'aaaa-mm' do bloco atual
  let temCabecalho = false;
  let blocoTotal = false;
  const naoAlinhadas = [];
  const cabecalho = {};

  for (const linha of linhas) {
    let m;
    if ((m = linha.match(/^Nome:\s*(\d+)\s*-\s*(.+?)\s+Centro de Custo:/i))) { cabecalho.matricula = m[1]; cabecalho.nome = m[2].trim(); continue; }
    if ((m = linha.match(/Admiss[aã]o:\s*(\d{2})\/(\d{2})\/(\d{4})/i))) { cabecalho.admissao = `${m[3]}-${m[2]}-${m[1]}`; continue; }
    if ((m = linha.match(/^Fun[cç][aã]o:\s*(.+?)\s+Classe\/N[ií]vel\/Letra:\s*(.+)$/i))) { cabecalho.funcao = m[1].trim(); cabecalho.classeNivel = m[2].trim(); continue; }

    if (/^Eventos\s+Tipo\b/i.test(linha)) {
      const comp = [...linha.matchAll(/(\d{2})\/(\d{4})-\d+/g)].map((x) => `${x[2]}-${x[1]}`);
      if (comp.length) {
        temCabecalho = true; blocoTotal = false; colunas = comp;
        comp.forEach((k) => { if (!meses.has(k)) meses.set(k, { rubricas: [], totais: {} }); });
      } else {
        blocoTotal = true; colunas = []; // coluna "Total" (soma do período) — não é um mês
      }
      continue;
    }
    if (!colunas.length || blocoTotal) continue;

    const mt = linha.match(/^Total\s+(Proventos|Descontos|L[ií]quido)\s+(.+)$/i);
    if (mt) {
      const chave = { proventos: 'totalProventos', descontos: 'totalDescontos', liquido: 'totalLiquido' }[mt[1].toLowerCase().replace('í', 'i')];
      const valores = mt[2].split(' ').map(paraNumero);
      if (valores.length === colunas.length) colunas.forEach((k, idx) => { if (valores[idx] != null) meses.get(k).totais[chave] = valores[idx]; });
      continue;
    }

    const ev = linha.match(REGEX_EVENTO_TEXTO);
    if (!ev) continue;
    const [, codigo, nomeBruto, grupoBruto, resto] = ev;
    const nome = nomeBruto.trim();
    const grupo = /^reten/i.test(grupoBruto) ? 'Retenção' : (/^desc/i.test(grupoBruto) ? 'Desconto' : 'Provento');
    const porMes = tokensDoMes(resto.split(' '), colunas.length);
    if (!porMes) { naoAlinhadas.push(nome); continue; }
    colunas.forEach((k, idx) => {
      const d = porMes[idx];
      if (!d || d.valor == null || d.valor === 0) return;
      const ehPercentual = !REGEX_NAO_E_PERCENTUAL.test(nome) && d.referencia != null && d.referencia > 0 && d.referencia <= 100;
      meses.get(k).rubricas.push({
        codigo, nome, tipo: grupo === 'Provento' ? 'provento' : 'desconto', grupo,
        percentual: ehPercentual ? d.referencia : null,
        referencia: d.referencia,
        valor: d.valor,
      });
    });
  }
  if (!temCabecalho) return null;

  const resultado = [];
  const mesesSemBase = [];
  for (const [competencia, v] of [...meses.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const base = v.rubricas.find((r) => /SAL[AÁ]RIO\s*BASE/i.test(r.nome));
    // Em afastamento com direitos integrais, o salário vem lançado em "HORAS AFASTADO COM DIREITOS INTEGRAIS"
    // (e SALÁRIO BASE some da ficha naquele mês) — o valor é o mesmo salário, só mudou o evento.
    const afastado = !base && v.rubricas.find((r) => /HORAS\s*AFASTADO\s*COM\s*DIREITOS\s*INTEGRAIS/i.test(r.nome));
    const fonteBase = base || afastado;
    if (!fonteBase) { if (v.rubricas.length) mesesSemBase.push(competencia); continue; }
    // Mês misto (parte afastado, parte trabalhado — ex: 28 dias afastado + 2 dias trabalhados): o salário do mês é a soma.
    const diasTrabalhados = afastado ? v.rubricas.find((r) => /DIAS\s*TRABALHADOS/i.test(r.nome)) : null;
    const basePagoMes = fonteBase.valor + (diasTrabalhados ? diasTrabalhados.valor : 0);

    const verbas = new Map();
    v.rubricas.forEach((r) => {
      if (r.tipo !== 'provento' || r.percentual == null) return;
      if (REGEX_NAO_ACOMPANHA_BASE.test(r.nome.toUpperCase())) return;
      if (!verbas.has(r.nome)) verbas.set(r.nome, r.percentual);
    });
    const soma = (tipo) => v.rubricas.filter((r) => r.tipo === tipo).reduce((a, r) => a + r.valor, 0);
    const totalProventosRubricas = soma('provento');
    const totalDescontosRubricas = soma('desconto');
    const confere = (lido, impresso) => (impresso == null ? null : Math.abs(lido - impresso) < 0.05);
    const campo = (re) => v.rubricas.find((r) => re.test(r.nome));
    const anuenio = campo(/ANU[EÊ]NIO/i), insal = campo(/INSALUBRIDADE/i);
    resultado.push({
      competencia,
      basePago: Math.round(basePagoMes * 100) / 100,
      salarioBase: base ? base.valor : null,
      baseVeioDeAfastamento: !!afastado,
      anuenio: anuenio?.valor ?? null, anuenioPercentual: anuenio?.percentual ?? null,
      insalubridade: insal?.valor ?? null, insalubridadePercentual: insal?.percentual ?? null,
      ...v.totais,
      verbasPercentuais: [...verbas.entries()].map(([nome, percentual]) => ({ nome, percentual })),
      rubricas: v.rubricas,
      totalProventosRubricas, totalDescontosRubricas,
      conferencia: { proventos: confere(totalProventosRubricas, v.totais.totalProventos), descontos: confere(totalDescontosRubricas, v.totais.totalDescontos) },
    });
  }
  return { meses: resultado, cabecalho, mesesSemBase, rubricasNaoAlinhadas: [...new Set(naoAlinhadas)] };
}

/**
 * Extrai uma tabela de níveis/categorias do PCS, reconhecendo a estrutura de
 * SUBGRUPO (ex: F1, F2, LM, LS, S) + NÍVEL (A, B, C, D) + CLASSE (1 a 15).
 * Tenta dois formatos comuns:
 *   1) Lista com um código combinado por linha (ex: "LM-A-12" ou "LM A12"),
 *      seguido do valor — o mais comum em tabelas de referência salarial.
 *   2) Grade (subgrupo + nível nas linhas, classe nas colunas) — se as linhas
 *      de tabela vierem nesse formato.
 * Best-effort — sempre revisar antes de usar.
 */
const REGEX_CODIGO_COMPLETO = /^([A-Z]{1,3}\d{0,2})[\s\-\/]*([A-D])[\s\-\/]*(\d{1,2})$/;

function extrairSubgrupoNivelClasse(rotulo) {
  const limpo = rotulo.toUpperCase().replace(/\s+/g, ' ').trim();
  const m = limpo.match(REGEX_CODIGO_COMPLETO);
  if (!m) return null;
  return { subgrupo: m[1], nivel: m[2], classe: parseInt(m[3], 10) };
}

function parseTabelaNiveis(texto) {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const regexValor = /R?\$?\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/;
  const niveis = [];
  for (const linha of linhas) {
    const matchValor = linha.match(regexValor);
    if (!matchValor) continue;
    const valor = paraNumero(matchValor[1]);
    if (valor == null || valor < 100) continue; // descarta números pequenos (não parecem salário)
    const rotulo = linha.slice(0, matchValor.index).trim().replace(/[.\-\s]+$/, '').replace(/\s{2,}/g, ' ');
    if (!rotulo) continue;
    const partes = extrairSubgrupoNivelClasse(rotulo);
    niveis.push({ rotulo, valor, subgrupo: partes?.subgrupo || null, nivel: partes?.nivel || null, classe: partes?.classe || null });
  }
  return niveis;
}

/**
 * Mesma extração, mas a partir de linhas de tabela estruturada (getTable()).
 * Tenta reconhecer tanto "uma linha = um código completo + valor" quanto uma
 * grade (subgrupo indicado antes do bloco, colunas = classe, linhas = nível).
 */
function parseTabelaNiveisDeTabelas(linhasTabela) {
  const niveis = [];
  let subgrupoAtual = null;
  let niveisPorIndice = null; // { indiceDaColuna: 'A'|'B'|'C'|'D' }
  let cargaHorariaAtual = null; // detecta "CARGA HORÁRIA DE 30 HORAS" / "... 40 HORAS", para não confundir tabelas diferentes com o mesmo código de subgrupo

  // Reconhece "SUBGRUPO - F1", "SUBGRUPO -M1", "SUBGRUPO LF", "S - NÍVEL SUPERIOR",
  // "TF - TÉCNICO E FISCAL" etc — sempre extraindo só o código curto do subgrupo.
  const REGEX_SUBGRUPO = /^(?:SUBGRUPO)?\s*-?\s*([A-Z]{1,3}\d{0,2})\b/i;

  for (const linha of linhasTabela) {
    if (!Array.isArray(linha) || !linha.length) continue;
    const celulas = linha.map((c) => (c == null ? '' : String(c).trim()));
    const outrasVazias = celulas.slice(1).every((c) => !c);

    const matchCarga = celulas[0] && celulas[0].match(/CARGA\s*HOR[AÁ]RIA\s*DE\s*(\d{2,3})\s*HORAS/i);
    if (matchCarga) { cargaHorariaAtual = matchCarga[1] + 'h'; continue; }

    // Linha de subgrupo: só a primeira célula preenchida, com um rótulo (não um número).
    if (outrasVazias && celulas[0] && !/^\d/.test(celulas[0])) {
      const m = celulas[0].toUpperCase().match(REGEX_SUBGRUPO);
      if (m) { subgrupoAtual = m[1]; niveisPorIndice = null; continue; }
    }

    // Linha de cabeçalho de grade: 2+ células reconhecíveis como nível (A, B, C ou D),
    // podendo vir com o percentual junto (ex: "B (5%)").
    const niveisNaLinha = {};
    celulas.forEach((c, idx) => {
      const m = c.toUpperCase().match(/^([A-D])\s*(\(\d+%?\))?$/);
      if (m) niveisNaLinha[idx] = m[1];
    });
    if (Object.keys(niveisNaLinha).length >= 2) {
      niveisPorIndice = niveisNaLinha;
      continue;
    }

    // Linha de classe dentro de uma grade já identificada: primeira célula é um
    // número 1-15 (a classe); as colunas nos índices do cabeçalho são os valores por nível.
    if (niveisPorIndice && /^\d{1,2}$/.test(celulas[0])) {
      const classe = parseInt(celulas[0], 10);
      // Se o cabeçalho não tinha uma célula em branco na posição da classe (ou
      // seja, o índice 0 já foi lido como um nível), a primeira célula dos dados
      // é só o rótulo da classe e precisa ser ignorada nessa leitura — desloca 1.
      const semColunaDeClasseNoCabecalho = niveisPorIndice[0] != null;
      celulas.forEach((valorStr, idx) => {
        if (semColunaDeClasseNoCabecalho && idx === 0) return; // é o rótulo da classe, não um valor
        const idxCabecalho = semColunaDeClasseNoCabecalho ? idx - 1 : idx;
        const nivel = niveisPorIndice[idxCabecalho];
        if (!nivel) return;
        const valor = paraNumero(valorStr);
        if (valor != null && valor >= 100) {
          const rotuloBase = `${subgrupoAtual || ''}-${nivel}${classe}`.replace(/^-/, '');
          niveis.push({
            rotulo: cargaHorariaAtual ? `${rotuloBase} (${cargaHorariaAtual})` : rotuloBase,
            valor, subgrupo: subgrupoAtual, nivel, classe, cargaHoraria: cargaHorariaAtual,
          });
        }
      });
      continue;
    }

    // Formato "lista": código completo numa célula + valor noutra (ex: "LM-A-12" | "3.440,89")
    for (let i = 0; i < celulas.length - 1; i++) {
      const partes = extrairSubgrupoNivelClasse(celulas[i]);
      if (!partes) continue;
      const valor = paraNumero(celulas[i + 1]);
      if (valor != null && valor >= 100) {
        niveis.push({ rotulo: celulas[i].toUpperCase(), valor, ...partes, cargaHoraria: cargaHorariaAtual });
      }
    }
  }
  return niveis;
}

/**
 * Extrai os dados de UM contracheque (um único mês), diferente da ficha
 * financeira (que traz vários meses lado a lado). Formato esperado: uma
 * linha por rubrica, geralmente "Código | Descrição | Referência(%) |
 * Vencimento/Desconto (R$)" — mas aceita variações na ordem das colunas,
 * testando cada linha por um rótulo conhecido + um percentual (opcional) +
 * um valor monetário. Best-effort — sempre revisar antes de usar.
 */
function parseContrachequeDeTabelas(linhasTabela) {
  const campos = {};
  const verbasExtras = [];

  for (const linha of linhasTabela) {
    if (!Array.isArray(linha) || !linha.length) continue;
    const celulas = linha.map((c) => (c == null ? '' : String(c).trim()));
    const rotulo = celulas.join(' ').toUpperCase();

    const campoReconhecido = CAMPOS_FICHA_FINANCEIRA.find((c) => c.regex.test(rotulo));
    const verbaConhecida = !campoReconhecido && VERBAS_CONHECIDAS.find((v) => rotulo.includes(v));
    if (!campoReconhecido && !verbaConhecida) continue;

    // A primeira célula costuma ser o "código" da rubrica (ex: "0001", "0416")
    // — um identificador, não um percentual nem um valor. Excluímos da busca
    // de números para não confundir o código com a referência/valor reais.
    const numeros = celulas.slice(1).map(paraNumero).filter((n) => n != null);
    if (!numeros.length) continue;

    // Nas linhas de contracheque, se houver 2 números, o primeiro <=100 costuma
    // ser o percentual/referência e o outro é o valor em reais; se só houver 1
    // número, é direto o valor (sem percentual reconhecível na própria linha).
    let percentual = null;
    let valor = null;
    if (numeros.length >= 2 && numeros[0] <= 100) {
      percentual = numeros[0];
      valor = numeros.slice(1).find((n) => n > 0) ?? null;
    } else {
      valor = numeros[numeros.length - 1];
    }
    if (valor == null) continue;

    if (campoReconhecido) {
      if (campoReconhecido.tipo === 'valor_unico') {
        campos[campoReconhecido.chave] = valor;
      } else {
        campos[campoReconhecido.chave] = valor;
        if (percentual != null) campos[campoReconhecido.chave + 'Percentual'] = percentual;
      }
    } else if (verbaConhecida && percentual != null) {
      // Usa o texto descritivo de verdade da linha (não só a palavra-chave
      // curta que bateu), para um nome mais informativo (ex: "GRATIFICACAO
      // GCECC" em vez de só "GRATIFICA").
      const celulaDescricao = celulas.slice(1).find((c) => c && Number.isNaN(Number(c.replace(/\./g, '').replace(',', '.')))) || verbaConhecida;
      verbasExtras.push({ nome: celulaDescricao, percentual });
    }
  }

  return {
    basePago: campos.salarioBase ?? null,
    ...campos,
    verbasPercentuais: verbasExtras,
  };
}

module.exports = {
  extrairTextoPdf, extrairTabelasPdf, linhasDeTextoTabulado, linhasDeTextoEspacado, pdfPareceEscaneado,
  parseFichaFinanceiraDeTabelas, parseFichaFinanceiraDeTexto, parseTabelaNiveis, parseTabelaNiveisDeTabelas,
  parseContrachequeDeTabelas,
};
