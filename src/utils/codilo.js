const { identificarTribunal } = require('./cnj');

/*
  Integração com a API privada da Codilo (docs.codilo.com.br), que substitui a
  API pública do Datajud (CNJ) neste sistema. Diferente do Datajud (metadados
  resumidos, gratuito), a Codilo é uma API paga, por crédito consumido a cada
  nova consulta, e devolve o texto completo de andamentos/decisões.

  Por isso mesmo, esta função só deve ser chamada a partir do perfil do CLIENTE
  (ver src/routes/processoConsulta.js), nunca da tela interna de Processos —
  cliques acidentais ali consumiriam créditos pagos à toa.

  Variáveis de ambiente necessárias:
    CODILO_CLIENT_ID     — "id" fornecido no painel da Codilo
    CODILO_CLIENT_SECRET — "secret" fornecido no painel da Codilo

  Fluxo (conforme documentação oficial):
    1) POST https://auth.codilo.com.br/oauth/token          -> access_token (cacheado até expirar)
    2) GET  https://api.consulta.codilo.com.br/v1/available -> mapa de tribunais/plataformas (cacheado)
    3) POST https://api.consulta.codilo.com.br/v1/request   -> cria a consulta (assíncrona)
    4) GET  https://api.consulta.codilo.com.br/v1/request/{id} -> aguarda o resultado (polling)
*/

const AUTH_URL = 'https://auth.codilo.com.br/oauth/token';
const API_BASE = 'https://api.consulta.codilo.com.br/v1';

let tokenCache = { valor: null, expiraEm: 0 };
let availableCache = { valor: null, expiraEm: 0 };

async function obterToken() {
  const agora = Date.now();
  if (tokenCache.valor && agora < tokenCache.expiraEm) return tokenCache.valor;

  const clientId = process.env.CODILO_CLIENT_ID;
  const clientSecret = process.env.CODILO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('A consulta de processos com texto completo ainda não foi ativada pelo escritório (faltam as credenciais da Codilo no servidor).');
  }

  const resp = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', id: clientId, secret: clientSecret }),
  });
  if (!resp.ok) {
    throw new Error('Não foi possível autenticar na API da Codilo agora. Confira as credenciais configuradas no servidor.');
  }
  const dados = await resp.json();
  tokenCache = {
    valor: dados.access_token,
    // renova um pouco antes de expirar de verdade, por segurança
    expiraEm: agora + Math.max((dados.expires_in || 3600) - 60, 30) * 1000,
  };
  return tokenCache.valor;
}

async function obterAbrangencia() {
  const agora = Date.now();
  if (availableCache.valor && agora < availableCache.expiraEm) return availableCache.valor;

  const token = await obterToken();
  const resp = await fetch(`${API_BASE}/available`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error('Não foi possível consultar a abrangência de tribunais da Codilo agora.');
  }
  const dados = await resp.json();
  availableCache = { valor: dados.data, expiraEm: agora + 6 * 60 * 60 * 1000 }; // cache de 6 horas
  return availableCache.valor;
}

/**
 * A partir do alias de tribunal (ex: "tjba", "trf1", vindo da identificação por
 * número CNJ) descobre qual "platform" e "query" usar nesta consulta, olhando
 * a abrangência atual retornada pela própria Codilo — evita depender de uma
 * tabela fixa nossa, que ficaria desatualizada conforme a Codilo evolui.
 */
async function resolverPlataforma(aliasTribunal) {
  const abrangencia = await obterAbrangencia();
  for (const fonte of abrangencia || []) {
    for (const plataforma of fonte.platforms || []) {
      const busca = (plataforma.searches || []).find((s) => s.search === aliasTribunal);
      if (busca) {
        const queries = busca.queries || [];
        const query = queries.find((q) => q.query === 'principal') || queries.find((q) => q.query === 'unificada') || queries[0];
        if (query) {
          return { platform: plataforma.platform, search: aliasTribunal, query: query.query };
        }
      }
    }
  }
  return null;
}

function aguardar(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function criarConsulta(token, platform, search, query, digitosCNJ) {
  const resp = await fetch(`${API_BASE}/request`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'courts', platform, search, query,
      param: { key: 'cnj', value: digitosCNJ },
      callbacks: [],
    }),
  });
  if (!resp.ok) {
    throw new Error(`A Codilo respondeu com erro ao criar a consulta (status ${resp.status}).`);
  }
  const dados = await resp.json();
  return dados.data;
}

async function buscarResultado(token, requestId, tentativas = 15, intervaloMs = 2000) {
  for (let i = 0; i < tentativas; i++) {
    const resp = await fetch(`${API_BASE}/request/${requestId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`A Codilo respondeu com erro ao consultar o resultado (status ${resp.status}).`);
    const dados = await resp.json();
    const status = dados?.requested?.status;
    if (status === 'success') return dados;
    if (status === 'warning') {
      throw new Error('Processo não encontrado na consulta pública deste tribunal (pode estar em segredo de justiça, ter migrado de sistema, ou não existir).');
    }
    if (status === 'error') {
      throw new Error('O tribunal não respondeu à consulta agora (instabilidade do sistema do tribunal). Tente novamente mais tarde.');
    }
    await aguardar(intervaloMs); // status "pending": aguarda e tenta de novo
  }
  throw new Error('A consulta está demorando mais que o esperado. Tente novamente em instantes.');
}

// Extrai um texto legível de um "step" (andamento) retornado pela Codilo, sem
// depender de um nome de campo único — o formato interno de cada tribunal varia.
function textoDoStep(step) {
  if (!step || typeof step !== 'object') return String(step || '');
  const camposPreferidos = ['description', 'descricao', 'complemento', 'conteudo', 'texto', 'movimentacao', 'title', 'titulo'];
  const partes = [];
  for (const campo of camposPreferidos) {
    if (step[campo] && typeof step[campo] === 'string') partes.push(step[campo]);
  }
  if (partes.length) return partes.join(' — ');
  // Nenhum campo conhecido: concatena todos os valores de texto do objeto, como último recurso.
  return Object.values(step).filter((v) => typeof v === 'string' && v.trim()).join(' — ') || 'Movimentação sem descrição.';
}

function dataDoStep(step) {
  return step?.date || step?.data || step?.dataHora || step?.datetime || null;
}

async function buscarUltimaMovimentacao(numeroCNJ) {
  const { digitos, alias } = identificarTribunal(numeroCNJ);
  const plataforma = await resolverPlataforma(alias);
  if (!plataforma) {
    throw new Error(`A Codilo ainda não cobre este tribunal (identificado como "${alias}"). Confira a abrangência atual em docs.codilo.com.br/available.`);
  }

  const token = await obterToken();
  const criada = await criarConsulta(token, plataforma.platform, plataforma.search, plataforma.query, digitos);
  const resultado = await buscarResultado(token, criada.id);

  const processoData = resultado?.data?.[0];
  const steps = processoData?.steps || [];
  if (!steps.length) {
    throw new Error('O processo foi encontrado, mas ainda não há andamentos registrados na base pública consultada.');
  }

  const ordenados = [...steps].sort((a, b) => {
    const da = new Date(dataDoStep(a) || 0).getTime();
    const db = new Date(dataDoStep(b) || 0).getTime();
    return db - da;
  });
  const ultimo = ordenados[0];

  return {
    dataMovimento: dataDoStep(ultimo),
    textoOriginal: textoDoStep(ultimo),
    tribunalAlias: alias,
  };
}

module.exports = { buscarUltimaMovimentacao };
