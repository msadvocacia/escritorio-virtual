const { buscarIndiceComCache } = require('./indices');

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

/**
 * Calcula a correção monetária e os juros de mora de um valor entre duas datas.
 *
 * @param {number} valorBase - valor original a corrigir
 * @param {string} dataInicial - 'aaaa-mm-dd', data do fato gerador (início da correção)
 * @param {string} dataFinal - 'aaaa-mm-dd', data até quando corrigir
 * @param {string} indice - 'INPC' | 'IPCA' | 'IPCA-E' | 'SELIC' | 'IGPM' | 'TR'
 * @param {object} juros - { tipo: 'nenhum'|'simples'|'composto', taxaAoMes: number (%), dataInicioJuros: 'aaaa-mm-dd' }
 */
async function calcularCorrecao(valorBase, dataInicial, dataFinal, indice, juros = { tipo: 'nenhum' }) {
  if (indice === 'SELIC' && juros && juros.tipo !== 'nenhum') {
    // Aviso importante: a Selic já embute juros no seu próprio índice mensal.
    // Somar juros de mora por cima causaria dupla contagem (bug jurídico real,
    // não só de código) — por isso bloqueamos essa combinação aqui.
    throw new Error('A Selic já embute juros de mora — não é correto somar juros adicionais sobre ela (isso causaria dupla contagem). Selecione "sem juros" ou escolha outro índice para aplicar juros por fora.');
  }

  const nomeIndiceBusca = indice === 'SELIC' ? 'SELIC_ACUMULADA_MES' : indice;
  const serie = await buscarIndiceComCache(nomeIndiceBusca, dataInicial, dataFinal);

  const mesInicial = dataInicial.slice(0, 7);
  const mesFinal = dataFinal.slice(0, 7);
  // Convenção: a correção incide a partir do mês SEGUINTE ao mês inicial até o
  // mês final (prática comum nos tribunais — "não incide correção no mês do
  // fato gerador"). Confira se a decisão judicial do seu caso determina outra
  // convenção antes de usar o resultado.
  const mesesUsados = serie.filter((m) => m.data > mesInicial && m.data <= mesFinal);

  let fator = 1;
  mesesUsados.forEach((m) => { fator *= (1 + (m.valor || 0) / 100); });

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
    mesesUsados: mesesUsados.map((m) => ({ mes: m.data, indice: m.valor })),
  };
}

module.exports = { calcularCorrecao, mesesEntre };
