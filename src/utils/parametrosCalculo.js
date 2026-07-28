const { getCollection, setCollection } = require('./store');

/*
  Alguns valores usados nos cálculos jurídicos mudam por portaria/lei/jurisprudência
  (teto e piso do INSS, por exemplo, mudam todo ano) ou são fatos históricos que
  raramente mudam (percentuais de expurgos de planos econômicos). Em vez de deixar
  isso fixo no código — o que exigiria eu editar e vocês reimplantarem o servidor
  toda vez que algo mudasse — guardamos num "parâmetro" editável no banco, que
  master/sócio podem atualizar direto na tela quando uma nova portaria sair.

  Isso é mais seguro do que tentar automatizar a busca dessas mudanças (leis e
  jurisprudência não têm uma API pública estruturada como os índices econômicos
  do Banco Central têm) — uma automação desse tipo correria o risco de interpretar
  errado uma mudança legislativa e alterar cálculos jurídicos sem revisão humana,
  o que seria pior do que manter isso como atualização manual, consciente e simples.
*/

const PADRAO = {
  tetoInss: 8475.55,
  pisoInss: 1621.00,
  atualizadoEm: null,
  // Tabela progressiva do INSS por ANO — essencial para cálculos retroativos que
  // atravessam vários anos (cada ano tem sua própria tabela/teto). Vem só com
  // 2026 pré-cadastrado; adicione os anos anteriores que precisar na tela de
  // Parâmetros de Cálculo (peça ao seu contador ou confira fontes públicas).
  // Se um ano não estiver cadastrado, o sistema usa a tabela do ano cadastrado
  // mais próximo (o anterior mais recente, ou o mais antigo disponível) —
  // como aproximação, nunca a melhor opção; cadastre o ano certo sempre que puder.
  tabelasInssPorAno: {
    2020: [ // vigente a partir de 03/2020
      { ate: 1045.00, aliquota: 7.5, parcelaDeduzir: 0 },
      { ate: 2089.60, aliquota: 9.0, parcelaDeduzir: 15.68 },
      { ate: 3134.40, aliquota: 12.0, parcelaDeduzir: 78.36 },
      { ate: 6101.06, aliquota: 14.0, parcelaDeduzir: 141.05 },
    ],
    2021: [
      { ate: 1100.00, aliquota: 7.5, parcelaDeduzir: 0 },
      { ate: 2203.48, aliquota: 9.0, parcelaDeduzir: 16.50 },
      { ate: 3305.22, aliquota: 12.0, parcelaDeduzir: 82.60 },
      { ate: 6433.57, aliquota: 14.0, parcelaDeduzir: 148.71 },
    ],
    2022: [
      { ate: 1212.00, aliquota: 7.5, parcelaDeduzir: 0 },
      { ate: 2427.35, aliquota: 9.0, parcelaDeduzir: 18.18 },
      { ate: 3641.03, aliquota: 12.0, parcelaDeduzir: 91.00 },
      { ate: 7087.22, aliquota: 14.0, parcelaDeduzir: 163.82 },
    ],
    2023: [ // vigente a partir de 05/2023 (usada para o ano inteiro, como aproximação — jan-abr/2023 teve faixas ligeiramente diferentes)
      { ate: 1320.00, aliquota: 7.5, parcelaDeduzir: 0 },
      { ate: 2571.29, aliquota: 9.0, parcelaDeduzir: 19.80 },
      { ate: 3856.94, aliquota: 12.0, parcelaDeduzir: 96.94 },
      { ate: 7507.49, aliquota: 14.0, parcelaDeduzir: 174.08 },
    ],
    2024: [
      { ate: 1412.00, aliquota: 7.5, parcelaDeduzir: 0 },
      { ate: 2666.68, aliquota: 9.0, parcelaDeduzir: 21.18 },
      { ate: 4000.03, aliquota: 12.0, parcelaDeduzir: 101.18 },
      { ate: 7786.02, aliquota: 14.0, parcelaDeduzir: 181.18 },
    ],
    2026: [
      { ate: 1621.00, aliquota: 7.5, parcelaDeduzir: 0 },
      { ate: 2902.84, aliquota: 9.0, parcelaDeduzir: 24.32 },
      { ate: 4354.27, aliquota: 12.0, parcelaDeduzir: 111.40 },
      { ate: 8475.55, aliquota: 14.0, parcelaDeduzir: 198.49 },
    ],
  },
  contribuicaoPatronalPadrao: 25.0,
  // RPPS — Regime Próprio de Previdência Social (comum em servidores municipais
  // e estaduais com fundo próprio). Diferente do INSS nacional (RGPS, tabela
  // progressiva), o RPPS costuma usar uma ALÍQUOTA FIXA definida por LEI
  // MUNICIPAL/ESTADUAL específica, que muda sempre que há reajuste (por lei
  // nova, não por portaria federal). Por isso fica separado, editável por ano,
  // e sem um valor padrão "nacional" — cada ente tem o seu. Confira a lei do
  // RPPS do seu cliente antes de usar.
  aliquotasRpppsPorAno: {},
  aliquotaPatronalRpppsPorAno: {},
  // Percentuais de expurgos inflacionários fixados em jurisprudência consolidada
  // (STJ, recursos repetitivos — Temas 264/284/285 do STF). Listados mês a mês
  // (não combinados) para evitar erro de composição — se o caso concreto exigir
  // mais de um mês, o próprio módulo de cálculo compõe os selecionados.
  planosEconomicos: [
    { chave: 'bresser_jun1987', label: 'Plano Bresser — junho/1987', percentual: 26.06 },
    { chave: 'verao_jan1989', label: 'Plano Verão — janeiro/1989', percentual: 42.72 },
    { chave: 'verao_fev1989', label: 'Plano Verão — fevereiro/1989', percentual: 10.14 },
    { chave: 'collor1_mar1990', label: 'Plano Collor I — março/1990', percentual: 84.32 },
    { chave: 'collor1_abr1990', label: 'Plano Collor I — abril/1990', percentual: 44.80 },
    { chave: 'collor1_jun1990', label: 'Plano Collor I — junho/1990', percentual: 9.55 },
    { chave: 'collor1_jul1990', label: 'Plano Collor I — julho/1990', percentual: 12.92 },
    { chave: 'collor2_jan1991', label: 'Plano Collor II — janeiro/1991', percentual: 13.69 },
    { chave: 'collor2_mar1991', label: 'Plano Collor II — março/1991', percentual: 13.90 },
  ],
};

async function obterParametrosCalculo() {
  const salvo = await getCollection('parametros_calculo', null);
  if (!salvo || !Object.keys(salvo).length) return PADRAO;
  return {
    ...PADRAO,
    ...salvo,
    planosEconomicos: salvo.planosEconomicos || PADRAO.planosEconomicos,
    tabelasInssPorAno: { ...PADRAO.tabelasInssPorAno, ...(salvo.tabelasInssPorAno || {}) },
    aliquotasRpppsPorAno: { ...PADRAO.aliquotasRpppsPorAno, ...(salvo.aliquotasRpppsPorAno || {}) },
    aliquotaPatronalRpppsPorAno: { ...PADRAO.aliquotaPatronalRpppsPorAno, ...(salvo.aliquotaPatronalRpppsPorAno || {}) },
  };
}

async function salvarParametrosCalculo(novos) {
  const atual = await obterParametrosCalculo();
  const atualizado = { ...atual, ...novos, atualizadoEm: new Date().toISOString() };
  await setCollection('parametros_calculo', atualizado);
  return atualizado;
}

async function calcularInssProgressivo(valorMensal, competencia) {
  const { tabelasInssPorAno, tetoInss } = await obterParametrosCalculo();
  const ano = competencia ? parseInt(competencia.slice(0, 4), 10) : null;
  const anosDisponiveis = Object.keys(tabelasInssPorAno).map(Number).sort((a, b) => a - b);
  let anoEscolhido = anosDisponiveis[anosDisponiveis.length - 1]; // padrão: o mais recente cadastrado
  if (ano != null) {
    // Prefere o ano exato; senão, o ano cadastrado mais próximo (o anterior mais
    // recente, ou o mais antigo disponível se o ano pedido for anterior a todos).
    if (tabelasInssPorAno[ano]) {
      anoEscolhido = ano;
    } else {
      const anterior = anosDisponiveis.filter((a) => a <= ano).pop();
      anoEscolhido = anterior != null ? anterior : anosDisponiveis[0];
    }
  }
  const tabela = tabelasInssPorAno[anoEscolhido];
  const tetoDaTabela = tabela[tabela.length - 1].ate;
  const base = Math.min(Math.max(valorMensal, 0), tetoDaTabela);
  const faixa = tabela.find((f) => base <= f.ate) || tabela[tabela.length - 1];
  const valor = base * (faixa.aliquota / 100) - faixa.parcelaDeduzir;
  return { valor: Math.max(valor, 0), anoUsado: anoEscolhido, anoExato: anoEscolhido === ano };
}

function buscarComFallbackDeAno(tabelaPorAno, ano) {
  const anosDisponiveis = Object.keys(tabelaPorAno).map(Number).sort((a, b) => a - b);
  if (!anosDisponiveis.length) return { valor: null, anoUsado: null, anoExato: false };
  if (tabelaPorAno[ano] != null) return { valor: tabelaPorAno[ano], anoUsado: ano, anoExato: true };
  const anterior = anosDisponiveis.filter((a) => a <= ano).pop();
  const anoEscolhido = anterior != null ? anterior : anosDisponiveis[0];
  return { valor: tabelaPorAno[anoEscolhido], anoUsado: anoEscolhido, anoExato: false };
}

async function obterAliquotaRpps(ano) {
  const { aliquotasRpppsPorAno } = await obterParametrosCalculo();
  return buscarComFallbackDeAno(aliquotasRpppsPorAno, ano);
}

async function obterAliquotaPatronalRpps(ano) {
  const { aliquotaPatronalRpppsPorAno, contribuicaoPatronalPadrao } = await obterParametrosCalculo();
  const r = buscarComFallbackDeAno(aliquotaPatronalRpppsPorAno, ano);
  if (r.valor == null) return { valor: contribuicaoPatronalPadrao, anoUsado: null, anoExato: false };
  return r;
}

module.exports = {
  obterParametrosCalculo, salvarParametrosCalculo, calcularInssProgressivo,
  obterAliquotaRpps, obterAliquotaPatronalRpps, PADRAO,
};
