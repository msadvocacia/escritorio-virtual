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
  'IPCA-E': 10764,  // IBGE/BCB — série própria do IPCA-E (Índice de Preços ao Consumidor Amplo
                     // Especial). Usada nos cálculos judiciais contra a Fazenda Pública até
                     // 08/12/2021 (Manual da Justiça Federal) e, quando a sentença do caso
                     // determinar, também depois de 30/08/2024 (a Lei 14.905/2024 prevê IPCA-15
                     // como padrão, mas a decisão judicial de cada processo pode fixar outro índice —
                     // confira sempre a sentença/decisão antes de escolher, já que isso muda o valor).
  'IPCA-15': 7478,  // IBGE/BCB — "prévia" mensal do IPCA, índice de correção padrão do
                     // art. 389 do Código Civil (redação da Lei 14.905/2024) a partir de 30/08/2024.
  SELIC: 432,    // meta Selic, mensal (% a.a.); para acumulado mensal usamos a série 4390
  SELIC_ACUMULADA_MES: 4390, // Selic acumulada no mês (% a.m.) — a usada em atualização monetária
  TAXA_LEGAL: 29543, // "Taxa Legal" do art. 406, §1º do Código Civil (Lei nº 14.905/2024) — o
                      // próprio Banco Central já publica esse valor pronto mensalmente (metodologia
                      // da Resolução CMN nº 5.171/2024), então usamos direto em vez de reconstruir a
                      // conta a partir da Selic e do IPCA-15 separados.
  POUPANCA: 196, // Rendimento mensal da caderneta de poupança (série oficial do BCB)
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

const DESCRICAO_SERIES = {
  'IPCA-E': 'IPCA-E — IBGE (série 10764 do SGS/BCB)',
  'IPCA-15': 'IPCA-15 — IBGE (série 7478 do SGS/BCB)',
  POUPANCA: 'Rendimento mensal da caderneta de poupança (série 196 do SGS/BCB)',
  TAXA_LEGAL: 'Taxa Legal — art. 406, §1º do CC (série 29543 do SGS/BCB)',
  SELIC_ACUMULADA_MES: 'Selic acumulada no mês (série 4390 do SGS/BCB)',
  INPC: 'INPC — IBGE (série 188 do SGS/BCB)',
  IPCA: 'IPCA — IBGE (série 433 do SGS/BCB)',
  IGPM: 'IGP-M — FGV (série 189 do SGS/BCB)',
  TR: 'Taxa Referencial (série 226 do SGS/BCB)',
  SELIC: 'Meta Selic (série 432 do SGS/BCB)',
};

function urlSerie(codigo) { return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json`; }

function converterSerie(bruto) {
  return bruto.map((item) => {
    const [, mes, ano] = item.data.split('/');
    return { data: `${ano}-${mes}`, valor: parseFloat(String(item.valor).replace(',', '.')) };
  });
}

/**
 * Busca (com cache de 24h no MongoDB) a série de um índice entre duas datas,
 * já convertida para { data: 'aaaa-mm', valor: number } por mês, e devolve
 * junto os METADADOS de auditoria: de onde veio (BCB ao vivo, cache válido
 * ou cache vencido usado por o BCB estar fora do ar) e quando foi consultado.
 */
async function buscarIndiceComMeta(nomeIndice, dataInicialISO, dataFinalISO) {
  const codigo = SERIES[nomeIndice];
  if (!codigo) throw new Error(`Índice "${nomeIndice}" não suportado.`);

  const chave = `indice:${nomeIndice}:${dataInicialISO}:${dataFinalISO}`;
  const cacheDoc = await DataCollection.findOne({ name: chave });
  const agora = Date.now();
  const meta = (origem, quando) => ({
    indice: nomeIndice, serieBCB: codigo, descricao: DESCRICAO_SERIES[nomeIndice] || nomeIndice,
    fonteUrl: urlSerie(codigo), origem, consultadoEm: new Date(quando).toISOString(),
  });
  if (cacheDoc && cacheDoc.updatedAt && agora - new Date(cacheDoc.updatedAt).getTime() < 24 * 60 * 60 * 1000) {
    return { serie: cacheDoc.data, meta: meta('cache', cacheDoc.updatedAt) };
  }

  let bruto;
  try {
    bruto = await buscarSerieBruta(codigo, dataInicialISO, dataFinalISO);
  } catch (erro) {
    // Banco Central indisponível: se já houver uma consulta anterior idêntica
    // salva, usa-a (mesmos valores oficiais, só mais antigos) e SINALIZA isso.
    // Sem nenhum cache, mantém o comportamento de antes: erro claro, sem chutar índice.
    if (cacheDoc && Array.isArray(cacheDoc.data) && cacheDoc.data.length) {
      return { serie: cacheDoc.data, meta: meta('cache-vencido', cacheDoc.updatedAt || agora) };
    }
    throw erro;
  }
  const serie = converterSerie(bruto);

  await DataCollection.findOneAndUpdate({ name: chave }, { $set: { data: serie } }, { upsert: true });
  return { serie, meta: meta('bcb', agora) };
}

async function buscarIndiceComCache(nomeIndice, dataInicialISO, dataFinalISO) {
  const { serie } = await buscarIndiceComMeta(nomeIndice, dataInicialISO, dataFinalISO);
  return serie;
}

/**
 * Teste de conexão: consulta AGORA (sem usar cache) o BCB para cada índice
 * usado nos cálculos e informa o último mês disponível. Serve para o
 * advogado conferir, antes de calcular, que os índices estão chegando.
 */
async function testarIndices() {
  const hoje = new Date();
  const ini = new Date(hoje.getFullYear() - 1, hoje.getMonth(), 1).toISOString().slice(0, 10);
  const fim = hoje.toISOString().slice(0, 10);
  const nomes = ['IPCA-E', 'IPCA-15', 'POUPANCA', 'SELIC_ACUMULADA_MES', 'TAXA_LEGAL'];
  const resultados = [];
  for (const nome of nomes) {
    const codigo = SERIES[nome];
    const t0 = Date.now();
    try {
      const serie = converterSerie(await buscarSerieBruta(codigo, ini, fim)).filter((m) => Number.isFinite(m.valor));
      const ultimo = serie[serie.length - 1];
      resultados.push({
        indice: nome, serieBCB: codigo, descricao: DESCRICAO_SERIES[nome], fonteUrl: urlSerie(codigo),
        ok: !!ultimo, ultimoMes: ultimo ? ultimo.data : null, ultimoValor: ultimo ? ultimo.valor : null,
        meses: serie.length, ms: Date.now() - t0,
        erro: ultimo ? null : 'A série veio vazia.',
      });
    } catch (e) {
      resultados.push({ indice: nome, serieBCB: codigo, descricao: DESCRICAO_SERIES[nome], fonteUrl: urlSerie(codigo), ok: false, ultimoMes: null, ultimoValor: null, meses: 0, ms: Date.now() - t0, erro: e.message });
    }
  }
  return { consultadoEm: new Date().toISOString(), todosOk: resultados.every((r) => r.ok), resultados };
}

module.exports = { buscarIndiceComCache, buscarIndiceComMeta, testarIndices, SERIES, DESCRICAO_SERIES };
