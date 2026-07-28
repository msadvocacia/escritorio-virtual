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
  // Um PDF com texto de verdade tem muitos caracteres por página; um PDF
  // escaneado (só imagem) devolve pouquíssimo ou nenhum texto extraído.
  return texto.replace(/\s/g, '').length < 200;
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

/**
 * Extrai, de linhas de tabela (uma linha = array de células, como devolvido
 * por getTable()), uma lista de {competencia, basePago, verbasPercentuais}
 * por mês. Best-effort — sempre revisar antes de usar.
 */
function parseFichaFinanceiraDeTabelas(linhasTabela) {
  const resultado = new Map(); // 'aaaa-mm' -> { basePago, verbas: Map(nome->percentual) }
  let competenciasAtuais = []; // [{mm, aaaa}], na ordem das colunas desta tabela/bloco

  const regexCompetencia = /^(\d{2})\/(\d{4})-\d+$/;

  for (const linha of linhasTabela) {
    if (!Array.isArray(linha) || !linha.length) continue;
    const celulas = linha.map((c) => (c == null ? '' : String(c).trim()));

    // Linha de cabeçalho de bloco: 2+ células no formato "mm/aaaa-n"
    const competenciasNaLinha = celulas
      .map((c) => c.match(regexCompetencia))
      .filter(Boolean)
      .map((m) => ({ mm: m[1], aaaa: m[2] }));
    if (competenciasNaLinha.length >= 2) {
      competenciasAtuais = competenciasNaLinha;
      competenciasAtuais.forEach(({ mm, aaaa }) => {
        const chave = `${aaaa}-${mm}`;
        if (!resultado.has(chave)) resultado.set(chave, { basePago: null, verbas: new Map() });
      });
      continue;
    }
    if (!competenciasAtuais.length) continue;

    const rotulo = celulas[0].toUpperCase();
    const isSalarioBase = /^1\s*-\s*SALARIO\s*BASE/.test(rotulo);
    const verbaConhecida = VERBAS_CONHECIDAS.find((v) => rotulo.includes(v));
    if (!isSalarioBase && !verbaConhecida) continue;

    // As demais células (depois do rótulo e do "Tipo") são números — percentual/valor por competência.
    const numeros = celulas.slice(1).map(paraNumero).filter((n) => n != null);
    if (!numeros.length) continue;

    if (isSalarioBase) {
      // 1 valor por competência (o próprio salário)
      competenciasAtuais.forEach(({ mm, aaaa }, idx) => {
        const chave = `${aaaa}-${mm}`;
        if (numeros[idx] != null) resultado.get(chave).basePago = numeros[idx];
      });
    } else {
      // 2 valores por competência (percentual, valor) — guardamos o percentual
      competenciasAtuais.forEach(({ mm, aaaa }, idx) => {
        const chave = `${aaaa}-${mm}`;
        const percentual = numeros[idx * 2];
        if (percentual != null && percentual <= 100) {
          resultado.get(chave).verbas.set(verbaConhecida, percentual);
        }
      });
    }
  }

  return [...resultado.entries()]
    .filter(([, v]) => v.basePago != null)
    .map(([competencia, v]) => ({
      competencia,
      basePago: v.basePago,
      verbasPercentuais: [...v.verbas.entries()].map(([nome, percentual]) => ({ nome, percentual })),
    }))
    .sort((a, b) => a.competencia.localeCompare(b.competencia));
}

/**
 * Extrai uma tabela de níveis/categorias do PCS (nível + valor do salário-base
 * naquele nível). Espera linhas com um identificador de nível (letras/números)
 * seguido de um valor monetário. Best-effort — sempre revisar antes de usar.
 */
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
    niveis.push({ nivel: rotulo, valor });
  }
  return niveis;
}

module.exports = { extrairTextoPdf, extrairTabelasPdf, pdfPareceEscaneado, parseFichaFinanceiraDeTabelas, parseTabelaNiveis };
