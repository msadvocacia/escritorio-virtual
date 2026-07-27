const DataCollection = require('../models/DataCollection');

/*
  Busca séries históricas de índices econômicos direto do Banco Central do
  Brasil (Sistema Gerenciador de Séries Temporais — SGS), API pública, sem
  necessidade de chave. Isso é deliberado: uma tabela de índices "fixa"
  digitada à mão ficaria desatualizada em poucos meses e qualquer erro de
  digitação teria consequência financeira real num cálculo judicial. Buscando
  direto da fonte oficial, o sistema sempre usa o valor correto e atual.

  Documentação: https://dadosabertos.bcb.gov.br (Sistema Gerenciador de Séries Temporais)
  Endpoint: https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados?formato=json&dataInicial=DD/MM/AAAA&dataFinal=DD/MM/AAAA
*/

const SERIES = {
  INPC: 188,     // IBGE, mensal
  IPCA: 433,     // IBGE, mensal
  'IPCA-E': 433, // Aproximação: usamos o IPCA mensal (IBGE) como proxy do IPCA-E.
                 // O IPCA-E "oficial" usado em precatórios é composto trimestralmente a
                 // partir do IPCA-15; para esse uso específico, confira a tabela oficial
                 // do tribunal antes de protocolar — ver aviso na tela.
  SELIC: 432,    // meta Selic, mensal (% a.a.); para acumulado mensal usamos a série 4390
  SELIC_ACUMULADA_MES: 4390, // Selic acumulada no mês (% a.m.) — a usada em atualização monetária
  IGPM: 189,     // FGV, mensal
  TR: 226,       // Taxa Referencial, mensal
};

function formatarDataBR(iso) {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

async function buscarSerieBruta(codigo, dataInicialISO, dataFinalISO) {
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json&dataInicial=${formatarDataBR(dataInicialISO)}&dataFinal=${formatarDataBR(dataFinalISO)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Não foi possível consultar o índice no Banco Central agora (status ${resp.status}). Tente novamente em instantes.`);
  }
  return resp.json(); // [{ data: "dd/mm/aaaa", valor: "0,53" }, ...]
}

/**
 * Busca (com cache de 24h no MongoDB) a série de um índice entre duas datas,
 * já convertida para { data: 'aaaa-mm', valor: number } por mês.
 */
async function buscarIndiceComCache(nomeIndice, dataInicialISO, dataFinalISO) {
  const codigo = SERIES[nomeIndice];
  if (!codigo) throw new Error(`Índice "${nomeIndice}" não suportado.`);

  const chave = `indice:${nomeIndice}:${dataInicialISO}:${dataFinalISO}`;
  const cacheDoc = await DataCollection.findOne({ name: chave });
  const agora = Date.now();
  if (cacheDoc && cacheDoc.updatedAt && agora - new Date(cacheDoc.updatedAt).getTime() < 24 * 60 * 60 * 1000) {
    return cacheDoc.data;
  }

  const bruto = await buscarSerieBruta(codigo, dataInicialISO, dataFinalISO);
  const serie = bruto.map((item) => {
    const [dia, mes, ano] = item.data.split('/');
    return { data: `${ano}-${mes}`, valor: parseFloat(item.valor.replace(',', '.')) };
  });

  await DataCollection.findOneAndUpdate({ name: chave }, { $set: { data: serie } }, { upsert: true });
  return serie;
}

module.exports = { buscarIndiceComCache, SERIES };
