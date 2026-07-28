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
  { chave: 'decimoTerceiro', label: '13º salário', regex: /^25\s*-|^\d+\s*-\s*13.?\s*SAL[AÁ]RIO\s*$/, tipo: 'valor_unico' },
  { chave: 'insalubridade13', label: 'Insalubridade (13º salário)', regex: /INSALUBRIDADE.*13/, tipo: 'valor_unico' },
  { chave: 'insalubridade', label: 'Insalubridade', regex: /INSALUBRIDADE/, tipo: 'percentual_valor' },
  { chave: 'anuenio13', label: 'Anuênio (13º salário)', regex: /ANU[EÊ]NIO.*13/, tipo: 'valor_unico' },
  { chave: 'anuenio', label: 'Anuênio', regex: /ANU[EÊ]NIO|ANUENIO/, tipo: 'percentual_valor' },
  { chave: 'tercoFerias', label: '1/3 de férias', regex: /1\/3\s*F[EÉ]RIAS/, tipo: 'percentual_valor' },
  { chave: 'sindicato', label: 'Sindicato', regex: /SINDSMUJE|SINDICATO/, tipo: 'percentual_valor' },
  { chave: 'salarioBase', label: 'Salário base', regex: /^1\s*-\s*SALARIO\s*BASE/, tipo: 'valor_unico' },
  { chave: 'totalProventos', label: 'Total de proventos', regex: /TOTAL\s*PROVENTOS/, tipo: 'valor_unico' },
  { chave: 'totalDescontos', label: 'Total de descontos', regex: /TOTAL\s*DESCONTOS/, tipo: 'valor_unico' },
  { chave: 'totalLiquido', label: 'Total líquido', regex: /TOTAL\s*L[IÍ]QUIDO/, tipo: 'valor_unico' },
  // Outras verbas percentuais não previstas acima ainda são capturadas
  // genericamente (ver VERBAS_CONHECIDAS), para não perder informação.
];

/**
 * Extrai, de linhas de tabela (uma linha = array de células, como devolvido
 * por getTable()), uma lista de {competencia, ...todosOsCamposReconhecidos}
 * por mês. Best-effort — sempre revisar antes de usar.
 */
function parseFichaFinanceiraDeTabelas(linhasTabela) {
  const resultado = new Map(); // 'aaaa-mm' -> { campos: {chave: valor}, verbasExtras: Map(nome->percentual) }
  let competenciasAtuais = []; // [{mm, aaaa}], na ordem das colunas desta tabela/bloco

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
        if (!resultado.has(chave)) resultado.set(chave, { campos: {}, verbasExtras: new Map() });
      });
      continue;
    }
    if (!competenciasAtuais.length) continue;

    const rotulo = celulas[0].toUpperCase();
    const campoReconhecido = CAMPOS_FICHA_FINANCEIRA.find((c) => c.regex.test(rotulo));
    const verbaConhecida = !campoReconhecido && VERBAS_CONHECIDAS.find((v) => rotulo.includes(v));
    if (!campoReconhecido && !verbaConhecida) continue;

    const numeros = celulas.slice(1).map(paraNumero).filter((n) => n != null);
    if (!numeros.length) continue;

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
      competenciasAtuais.forEach(({ mm, aaaa }, idx) => {
        const chave = `${aaaa}-${mm}`;
        const percentual = numeros[idx * 2];
        if (percentual != null && percentual <= 100) resultado.get(chave).verbasExtras.set(verbaConhecida, percentual);
      });
    }
  }

  return [...resultado.entries()]
    .filter(([, v]) => v.campos.salarioBase != null)
    .map(([competencia, v]) => ({
      competencia,
      basePago: v.campos.salarioBase,
      ...v.campos,
      verbasPercentuais: [...v.verbasExtras.entries()].map(([nome, percentual]) => ({ nome, percentual })),
    }))
    .sort((a, b) => a.competencia.localeCompare(b.competencia));
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

  // Reconhece "SUBGRUPO - F1", "SUBGRUPO -M1", "SUBGRUPO LF", "S - NÍVEL SUPERIOR",
  // "TF - TÉCNICO E FISCAL" etc — sempre extraindo só o código curto do subgrupo.
  const REGEX_SUBGRUPO = /^(?:SUBGRUPO)?\s*-?\s*([A-Z]{1,3}\d{0,2})\b/i;

  for (const linha of linhasTabela) {
    if (!Array.isArray(linha) || !linha.length) continue;
    const celulas = linha.map((c) => (c == null ? '' : String(c).trim()));
    const outrasVazias = celulas.slice(1).every((c) => !c);

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
          niveis.push({
            rotulo: `${subgrupoAtual || ''}-${nivel}${classe}`.replace(/^-/, ''),
            valor, subgrupo: subgrupoAtual, nivel, classe,
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
        niveis.push({ rotulo: celulas[i].toUpperCase(), valor, ...partes });
      }
    }
  }
  return niveis;
}

module.exports = {
  extrairTextoPdf, extrairTabelasPdf, pdfPareceEscaneado,
  parseFichaFinanceiraDeTabelas, parseTabelaNiveis, parseTabelaNiveisDeTabelas,
};
