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
  return { ...PADRAO, ...salvo, planosEconomicos: salvo.planosEconomicos || PADRAO.planosEconomicos };
}

async function salvarParametrosCalculo(novos) {
  const atual = await obterParametrosCalculo();
  const atualizado = { ...atual, ...novos, atualizadoEm: new Date().toISOString() };
  await setCollection('parametros_calculo', atualizado);
  return atualizado;
}

module.exports = { obterParametrosCalculo, salvarParametrosCalculo, PADRAO };
