const { limparNumero } = require('./cnj');

/*
  Integração com a API privada da BuscaProcessos (docs.buscaprocessos.app.br),
  que substitui a Codilo (também descontinuada) como fonte de dados processuais
  com texto completo — diferente do Datajud, que só trazia metadados resumidos.

  Autenticação: simples, por API Key fixa no header (sem fluxo OAuth como a
  Codilo tinha). A própria API identifica o tribunal a partir do número CNJ,
  então não precisamos mais resolver "qual tribunal/plataforma" nós mesmos.

  Variável de ambiente necessária:
    BUSCAPROCESSOS_API_KEY — gerada no painel: https://buscaprocessos.app.br/dashboard/keys

  Endpoint usado: GET /v1/processos/cnj/{cnj}/movimentacoes
  (síncrono, cobrado por requisição — sem necessidade de polling)
*/

const BASE_URL = 'https://api.buscaprocessos.app.br';

const MENSAGENS_ERRO = {
  API_KEY_REQUIRED: 'A consulta de processos com texto completo ainda não foi ativada pelo escritório (falta a chave da BuscaProcessos no servidor).',
  INVALID_API_KEY: 'A chave da BuscaProcessos configurada no servidor não é válida. Confira no painel deles.',
  ACCOUNT_INACTIVE: 'A conta da BuscaProcessos do escritório está inativa. Fale com o administrador do sistema.',
  EMAIL_VERIFICATION_REQUIRED: 'A conta da BuscaProcessos ainda não confirmou o e-mail. Fale com o administrador do sistema.',
  INSUFFICIENT_CREDITS: 'Os créditos da BuscaProcessos acabaram. É necessário recarregar no painel deles para continuar consultando.',
  MISSING_DOCUMENT: 'Número de processo não informado corretamente.',
  INVALID_DOCUMENT: 'Número de processo inválido.',
  INVALID_API_HOST: 'Erro de configuração interna (endereço da API incorreto). Avise o administrador do sistema.',
};

async function chamarBuscaProcessos(caminho) {
  const apiKey = process.env.BUSCAPROCESSOS_API_KEY;
  if (!apiKey) throw new Error(MENSAGENS_ERRO.API_KEY_REQUIRED);

  let resp;
  try {
    resp = await fetch(`${BASE_URL}${caminho}`, {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    });
  } catch (e) {
    throw new Error('Não foi possível contatar a API da BuscaProcessos agora. Tente novamente mais tarde.');
  }

  const dados = await resp.json().catch(() => null);

  if (!resp.ok) {
    const codigo = dados?.error?.code;
    if (codigo && MENSAGENS_ERRO[codigo]) throw new Error(MENSAGENS_ERRO[codigo]);
    if (resp.status === 404) {
      throw new Error('Processo não encontrado na base pública consultada (pode estar em segredo de justiça, ter migrado de sistema, ou não existir).');
    }
    if (resp.status === 429) {
      throw new Error('Muitas consultas em pouco tempo na BuscaProcessos. Tente novamente em instantes.');
    }
    if (resp.status === 502) {
      throw new Error('O tribunal não respondeu à consulta agora (instabilidade da fonte). Tente novamente mais tarde.');
    }
    throw new Error(dados?.error?.message || `A BuscaProcessos respondeu com erro (status ${resp.status}).`);
  }

  return dados;
}

// Extrai a lista de movimentações de dentro do envelope de resposta, sem
// depender de um único formato — a API pode devolver um array direto em
// `data`, ou aninhado em `data.movimentacoes`/`data.items`/`data.results`.
function extrairListaMovimentacoes(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.movimentacoes)) return data.movimentacoes;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

function dataDoMovimento(mov) {
  return mov?.data || mov?.date || mov?.dataMovimentacao || mov?.data_movimentacao || mov?.dataHora || mov?.datetime || null;
}

function textoDoMovimento(mov) {
  if (!mov || typeof mov !== 'object') return String(mov || '');
  const camposPreferidos = ['descricao', 'texto', 'conteudo', 'complemento', 'movimento', 'title', 'titulo', 'resumo', 'description'];
  const partes = [];
  for (const campo of camposPreferidos) {
    if (mov[campo] && typeof mov[campo] === 'string') partes.push(mov[campo]);
  }
  if (partes.length) return partes.join(' — ');
  return Object.values(mov).filter((v) => typeof v === 'string' && v.trim()).join(' — ') || 'Movimentação sem descrição.';
}

async function buscarUltimaMovimentacao(numeroCNJ) {
  const digitos = limparNumero(numeroCNJ);
  const resposta = await chamarBuscaProcessos(`/v1/processos/cnj/${digitos}/movimentacoes`);
  const lista = extrairListaMovimentacoes(resposta.data);

  if (!lista.length) {
    throw new Error('O processo foi encontrado, mas ainda não há movimentações registradas na base pública consultada.');
  }

  const ordenados = [...lista].sort((a, b) => {
    const da = new Date(dataDoMovimento(a) || 0).getTime();
    const db = new Date(dataDoMovimento(b) || 0).getTime();
    return db - da;
  });
  const ultimo = ordenados[0];

  return {
    dataMovimento: dataDoMovimento(ultimo),
    textoOriginal: textoDoMovimento(ultimo),
  };
}

module.exports = { buscarUltimaMovimentacao };
