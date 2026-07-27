const { buscarIndiceComCache } = require('./indices');
const { obterParametrosCalculo } = require('./parametrosCalculo');

/*
  Módulo previdenciário — construído com cautela extra, porque este é
  provavelmente o cálculo mais usado no escritório e o de maior risco de erro
  se eu tentasse cobrir tudo de uma vez.

  ESCOPO DELIBERADAMENTE LIMITADO: cobre apenas a REGRA PERMANENTE pós-reforma
  (EC 103/2019) — a mais comum hoje em dia para quem ainda não tinha direito
  adquirido nem cumpriu regra de transição em 13/11/2019.

  NÃO cobre (e não deve ser usado para): fator previdenciário, regras de
  transição por pontos/pedágio 50%/pedágio 100%, divisor mínimo de 108
  contribuições, aposentadoria especial com conversão de tempo, invalidez,
  ou "revisão da vida toda" — essa última, aliás, foi definitivamente
  REJEITADA pelo STF em 2026 (Tema 1.102, trânsito em julgado 19/06/2026),
  então não faz mais sentido oferecer esse cálculo.

  Valores 2026 (Portaria Interministerial MPS/MF nº 13/2026):
    Teto do INSS: R$ 8.475,55
    Piso (salário mínimo): R$ 1.621,00
*/

const TETO_INSS_2026 = 8475.55;
const PISO_INSS_2026 = 1621.00;

/**
 * Corrige uma lista de salários de contribuição pelo INPC até a data do
 * cálculo (data de início do benefício), e calcula a média simples.
 * salarios: [{ competencia: 'aaaa-mm', valor: number }]
 */
async function calcularSalarioBeneficio(salarios, dataCalculo) {
  if (!Array.isArray(salarios) || !salarios.length) {
    throw new Error('Informe ao menos um salário de contribuição.');
  }
  const competencias = salarios.map((s) => s.competencia).sort();
  const dataInicial = `${competencias[0]}-01`;
  const serie = await buscarIndiceComCache('INPC', dataInicial, dataCalculo);

  const mesDoCalculo = dataCalculo.slice(0, 7);
  const salariosCorrigidos = salarios.map((s) => {
    const fator = serie
      .filter((m) => m.data > s.competencia && m.data <= mesDoCalculo)
      .reduce((f, m) => f * (1 + (m.valor || 0) / 100), 1);
    return { competencia: s.competencia, valorOriginal: s.valor, valorCorrigido: s.valor * fator };
  });

  const somaCorrigida = salariosCorrigidos.reduce((s, x) => s + x.valorCorrigido, 0);
  const salarioBeneficio = somaCorrigida / salariosCorrigidos.length;

  return { salariosCorrigidos, quantidadeMeses: salariosCorrigidos.length, salarioBeneficio };
}

/**
 * RMI pela regra permanente (EC 103/2019): 60% da média + 2% por ano que
 * exceder o tempo mínimo exigido, respeitando teto e piso do INSS.
 */
async function calcularRMIRegraPermanente(salarioBeneficio, anosContribuicao, anosMinimoExigido) {
  const { tetoInss, pisoInss } = await obterParametrosCalculo();
  const anosExcedentes = Math.max(anosContribuicao - anosMinimoExigido, 0);
  const coeficiente = Math.min(0.60 + 0.02 * anosExcedentes, 1.00);
  let rmi = salarioBeneficio * coeficiente;
  rmi = Math.min(rmi, tetoInss);
  rmi = Math.max(rmi, pisoInss);
  return { coeficiente, rmiAntesLimites: salarioBeneficio * coeficiente, rmi, teto: tetoInss, piso: pisoInss };
}

module.exports = { calcularSalarioBeneficio, calcularRMIRegraPermanente };
