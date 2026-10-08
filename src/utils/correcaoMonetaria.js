const { buscarIndiceComMeta } = require('./indices');

/*
  Motor único de correção monetária e juros de mora — usado por todos os
  módulos de cálculo (trabalhista, cível, previdenciário, etc.), em vez de
  reescrever essa lógica em cada um separadamente.
*/

function mesesEntre(inicioISO, fimISO) {
  const [ai, mi] = inicioISO.split('-').map(Number);
  const [af, mf] = fimISO.split('-').map(Number);
  return (af - ai) * 12 + (mf - mi);
}

function diasNoMes(ano, mes) { return new Date(ano, mes, 0).getDate(); } // mês 1-indexado

// Monta a lista de meses efetivamente usados, cada um com seu "peso" (1 = mês
// cheio; fração = mês parcial nas pontas do período). Compartilhado pela
// correção (multiplicativa) e pelos juros simples (aditivos), para os dois
// tratarem o pró-rata da mesma forma.
function pesosPorMes(serie, dataInicialISO, dataFinalISO, proRata) {
  const [anoI, mesI, diaI] = dataInicialISO.split('-').map(Number);
  const [anoF, mesF, diaF] = dataFinalISO.split('-').map(Number);
  const mesInicial = dataInicialISO.slice(0, 7);
  const mesFinal = dataFinalISO.slice(0, 7);

  if (!proRata) {
    // Convenção tradicional (mantida como padrão para não alterar os demais
    // módulos que já usam este motor): mês do fato gerador não entra; do mês
    // seguinte até o mês final, cheio.
    return serie.filter((m) => m.data > mesInicial && m.data <= mesFinal).map((m) => ({ ...m, peso: 1 }));
  }

  // Pró-rata nominal nas duas pontas: o mês inicial entra com a fração de
  // dias restantes (da data inicial, inclusive, até o fim do mês); o mês
  // final entra com a fração de dias já passados (do início do mês até a
  // data final, inclusive); os meses entre as pontas entram cheios (peso 1).
  return serie
    .filter((m) => m.data >= mesInicial && m.data <= mesFinal)
    .map((m) => {
      let peso = 1;
      const ehMesInicial = m.data === mesInicial;
      const ehMesFinal = m.data === mesFinal;
      if (ehMesInicial && ehMesFinal) {
        // período inteiro cabe dentro de um único mês
        peso = Math.max(diaF - diaI + 1, 0) / diasNoMes(anoI, mesI);
      } else if (ehMesInicial) {
        const totalDias = diasNoMes(anoI, mesI);
        peso = (totalDias - diaI + 1) / totalDias;
      } else if (ehMesFinal) {
        const totalDias = diasNoMes(anoF, mesF);
        peso = diaF / totalDias;
      }
      return { ...m, peso };
    });
}

/**
 * Calcula a correção monetária e os juros de mora de um valor entre duas datas.
 *
 * @param {number} valorBase - valor original a corrigir
 * @param {string} dataInicial - 'aaaa-mm-dd', data do fato gerador (início da correção)
 * @param {string} dataFinal - 'aaaa-mm-dd', data até quando corrigir
 * @param {string} indice - 'INPC' | 'IPCA' | 'IPCA-E' | 'SELIC' | 'IGPM' | 'TR'
 * @param {object} juros - { tipo: 'nenhum'|'simples'|'composto', taxaAoMes: number (%), dataInicioJuros: 'aaaa-mm-dd' }
 * @param {boolean} proRata - se true, usa pró-rata nominal (dia a dia) no primeiro e no último mês, em vez de contar só meses cheios (padrão: false, para não alterar o comportamento dos módulos que já usam esta função)
 */
async function calcularCorrecao(valorBase, dataInicial, dataFinal, indice, juros = { tipo: 'nenhum' }, proRata = false) {
  if (indice === 'SELIC' && juros && juros.tipo !== 'nenhum') {
    // Aviso importante: a Selic já embute juros no seu próprio índice mensal.
    // Somar juros de mora por cima causaria dupla contagem (bug jurídico real,
    // não só de código) — por isso bloqueamos essa combinação aqui.
    throw new Error('A Selic já embute juros de mora — não é correto somar juros adicionais sobre ela (isso causaria dupla contagem). Selecione "sem juros" ou escolha outro índice para aplicar juros por fora.');
  }

  const nomeIndiceBusca = indice === 'SELIC' ? 'SELIC_ACUMULADA_MES' : indice;
  const { serie, meta } = await buscarIndiceComMeta(nomeIndiceBusca, dataInicial, dataFinal);
  const mesesUsados = pesosPorMes(serie, dataInicial, dataFinal, proRata);

  let fator = 1;
  const fatoresAcumulados = [];
  mesesUsados.forEach((m) => { fator *= (1 + ((m.valor || 0) / 100) * m.peso); fatoresAcumulados.push(fator); });

  const valorCorrigido = valorBase * fator;

  let valorJuros = 0;
  if (juros && juros.tipo !== 'nenhum' && juros.taxaAoMes) {
    const dataInicioJuros = juros.dataInicioJuros || dataInicial;
    const nMeses = Math.max(mesesEntre(dataInicioJuros, dataFinal), 0);
    const taxa = juros.taxaAoMes / 100;
    if (juros.tipo === 'simples') {
      valorJuros = valorCorrigido * taxa * nMeses;
    } else if (juros.tipo === 'composto') {
      valorJuros = valorCorrigido * (Math.pow(1 + taxa, nMeses) - 1);
    }
  }

  return {
    valorBase,
    indice,
    fatorCorrecao: fator,
    valorCorrigido,
    valorJuros,
    valorFinal: valorCorrigido + valorJuros,
    mesesUsados: mesesUsados.map((m) => ({ mes: m.data, indice: m.valor, peso: m.peso })),
    // Trilha de auditoria (acrescentada; não altera nenhum valor calculado)
    fonte: meta,
    mesesAuditoria: mesesUsados.map((m, i) => ({ mes: m.data, indice: m.valor, peso: m.peso, fatorAcumulado: fatoresAcumulados[i] })),
  };
}

module.exports = { calcularCorrecao, mesesEntre };

/*
  ATUALIZAÇÃO COM TROCA AUTOMÁTICA DE REGIME — TRÊS FASES, COM PRÓ-RATA
  =======================================================================
  Condenações contra a Fazenda Pública passaram por DUAS mudanças legais
  sucessivas, e o sistema aplica as três fases automaticamente, encadeadas,
  com pró-rata nominal (dia a dia) no primeiro e no último mês de cada fase —
  confirmado contra um cálculo já homologado que você me mostrou:

  1) Até 08/12/2021 — IPCA-E (correção) + juros de mora simples, mês a mês,
     pela taxa da caderneta de poupança.
  2) De 09/12/2021 a 29/08/2024 — Selic acumulada mensalmente, pura (a Selic já
     embute correção e juros), Art. 3º da EC nº 113/2021.
  3) A partir de 30/08/2024 — IPCA-E (correção) + "Taxa Legal" de juros
     simples (Selic − IPCA-15, publicada pronta pelo Banco Central, série
     29543), Lei nº 14.905/2024. IMPORTANTE: o padrão da lei é IPCA-15 na
     correção desta fase, mas usei IPCA-E aqui porque foi o que a sentença do
     caso que você me mostrou determinou — se outra ação do escritório tiver
     uma sentença diferente (mandando usar IPCA-15, por exemplo), me avise
     que ajusto por caso, já que isso muda o valor final.

  Cada fase começa de onde a anterior parou (o valor já corrigido "carrega"
  para a fase seguinte).
*/
const DATA_LIMITE_REGIME_ANTERIOR = '2021-12-08';
const DATA_INICIO_SELIC = '2021-12-09';
const DATA_LIMITE_SELIC_PURA = '2024-08-29';
const DATA_INICIO_LEI_14905 = '2024-08-30';

async function calcularJurosSimplesPorSerie(nomeIndice, valorCorrigidoBase, dataInicial, dataFinal) {
  const { serie, meta } = await buscarIndiceComMeta(nomeIndice, dataInicial, dataFinal);
  const mesesUsados = pesosPorMes(serie, dataInicial, dataFinal, true);
  let total = 0;
  let percentualAcumulado = 0;
  mesesUsados.forEach((m) => { total += valorCorrigidoBase * ((m.valor || 0) / 100) * m.peso; percentualAcumulado += (m.valor || 0) * m.peso; });
  return {
    total,
    mesesUsados: mesesUsados.map((m) => ({ mes: m.data, indice: m.valor, peso: m.peso })),
    fonte: meta, percentualAcumulado,
  };
}

async function aplicarFase(valor, regime, dataInicial, dataFinal) {
  if (regime === 'selic') {
    const r = await calcularCorrecao(valor, dataInicial, dataFinal, 'SELIC', { tipo: 'nenhum' }, true);
    return { valorFinal: r.valorFinal, detalhe: { regime: 'Selic acumulada mensalmente (Art. 3º da EC nº 113/2021)', de: dataInicial, ate: dataFinal, valorInicial: valor, valorFinal: r.valorFinal, mesesUsados: r.mesesUsados,
      fatorCorrecao: r.fatorCorrecao, jurosPercentual: 0,
      series: [{ papel: 'correção e juros (Selic embute ambos)', indice: 'SELIC_ACUMULADA_MES', fonte: r.fonte, meses: r.mesesAuditoria }] } };
  }
  if (regime === 'ipca-e+poupanca') {
    const rCorr = await calcularCorrecao(valor, dataInicial, dataFinal, 'IPCA-E', { tipo: 'nenhum' }, true);
    const rJuros = await calcularJurosSimplesPorSerie('POUPANCA', rCorr.valorCorrigido, dataInicial, dataFinal);
    const valorFinal = rCorr.valorCorrigido + rJuros.total;
    return { valorFinal, detalhe: { regime: 'IPCA-E (correção) + juros de mora simples pela poupança', de: dataInicial, ate: dataFinal, valorInicial: valor, valorCorrigido: rCorr.valorCorrigido, juros: rJuros.total, valorFinal, mesesUsados: rCorr.mesesUsados,
      fatorCorrecao: rCorr.fatorCorrecao, jurosPercentual: rJuros.percentualAcumulado,
      series: [
        { papel: 'correção monetária', indice: 'IPCA-E', fonte: rCorr.fonte, meses: rCorr.mesesAuditoria },
        { papel: 'juros de mora (simples)', indice: 'POUPANCA', fonte: rJuros.fonte, meses: rJuros.mesesUsados },
      ] } };
  }
  // ipca-e+taxalegal — Lei 14.905/2024, com o índice de correção que a sentença do caso determinar (IPCA-E aqui)
  const rCorr = await calcularCorrecao(valor, dataInicial, dataFinal, 'IPCA-E', { tipo: 'nenhum' }, true);
  const rJuros = await calcularJurosSimplesPorSerie('TAXA_LEGAL', rCorr.valorCorrigido, dataInicial, dataFinal);
  const valorFinal = rCorr.valorCorrigido + rJuros.total;
  return { valorFinal, detalhe: { regime: 'IPCA-E (correção) + Taxa Legal de juros (Selic − IPCA-15, art. 406 do CC, Lei nº 14.905/2024)', de: dataInicial, ate: dataFinal, valorInicial: valor, valorCorrigido: rCorr.valorCorrigido, juros: rJuros.total, valorFinal, mesesUsados: rJuros.mesesUsados,
    fatorCorrecao: rCorr.fatorCorrecao, jurosPercentual: rJuros.percentualAcumulado,
    series: [
      { papel: 'correção monetária', indice: 'IPCA-E', fonte: rCorr.fonte, meses: rCorr.mesesAuditoria },
      { papel: 'juros de mora (simples)', indice: 'TAXA_LEGAL', fonte: rJuros.fonte, meses: rJuros.mesesUsados },
    ] } };
}

// regimeFazenda:
//   'taxa-legal' (padrão, comportamento original): IPCA-E + poupança até 08/12/2021; Selic até 29/08/2024;
//                IPCA-E + Taxa Legal depois — usado quando a sentença do caso assim determina.
//   'selic': IPCA-E + poupança até 08/12/2021; Selic acumulada de 09/12/2021 até a data de
//            atualização (art. 3º da EC 113/2021; tese do STF no Tema 1.419).
function dividirEmRegimes(dataInicial, dataFinal, regimeFazenda = 'taxa-legal') {
  const trechosPossiveis = regimeFazenda === 'selic' ? [
    { regime: 'ipca-e+poupanca', de: dataInicial, ate: DATA_LIMITE_REGIME_ANTERIOR },
    { regime: 'selic', de: DATA_INICIO_SELIC, ate: dataFinal },
  ] : [
    { regime: 'ipca-e+poupanca', de: dataInicial, ate: DATA_LIMITE_REGIME_ANTERIOR },
    { regime: 'selic', de: DATA_INICIO_SELIC, ate: DATA_LIMITE_SELIC_PURA },
    { regime: 'ipca-e+taxalegal', de: DATA_INICIO_LEI_14905, ate: dataFinal },
  ];
  return trechosPossiveis
    .map((t) => ({ ...t, de: t.de > dataInicial ? t.de : dataInicial, ate: t.ate < dataFinal ? t.ate : dataFinal }))
    .filter((t) => t.de <= t.ate);
}

async function calcularCorrecaoComTransicaoSelic(valorBase, dataInicial, dataFinal, opcoes = {}) {
  if (!valorBase) return { valorBase: 0, valorFinal: 0, valorCorrecao: 0, regime: 'nenhum', fases: [] };
  const trechos = dividirEmRegimes(dataInicial, dataFinal, opcoes.regimeFazenda === 'selic' ? 'selic' : 'taxa-legal');
  let valorCorrente = valorBase;
  const fases = [];
  for (const trecho of trechos) {
    const { valorFinal, detalhe } = await aplicarFase(valorCorrente, trecho.regime, trecho.de, trecho.ate);
    fases.push(detalhe);
    valorCorrente = valorFinal;
  }
  return {
    valorBase, valorFinal: valorCorrente, valorCorrecao: valorCorrente - valorBase,
    regime: fases.length > 1 ? 'transicao' : (fases[0]?.regime || 'nenhum'),
    fases,
  };
}

module.exports.calcularCorrecaoComTransicaoSelic = calcularCorrecaoComTransicaoSelic;
module.exports.DATA_LIMITE_REGIME_ANTERIOR = DATA_LIMITE_REGIME_ANTERIOR;
module.exports.DATA_INICIO_SELIC = DATA_INICIO_SELIC;
module.exports.DATA_LIMITE_SELIC_PURA = DATA_LIMITE_SELIC_PURA;
module.exports.DATA_INICIO_LEI_14905 = DATA_INICIO_LEI_14905;
