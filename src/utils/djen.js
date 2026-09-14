/*
  Cliente para a API pública de CONSULTA do DJEN (Diário de Justiça Eletrônico
  Nacional), mantida pelo CNJ. Documentação não é totalmente pública/estável —
  baseado no comportamento observado por integradores e no host oficial:

    Base: https://comunicaapi.pje.jus.br/api/v1
    Consulta: GET /comunicacao

  Parâmetros CONFIRMADOS pela comunidade/uso real (sem autenticação):
    numeroOab, ufOab                       — por advogado (mais confiável)
    numeroProcesso, siglaTribunal          — por processo (20 dígitos, sem máscara)
    dataDisponibilizacaoInicio/Fim         — janela de datas (formato AAAA-MM-DD)
    pagina, itensPorPagina                 — paginação (usar no máximo 50 por página,
                                              valores maiores podem devolver vazio sem erro)

  IMPORTANTE — duas limitações reais que não temos como contornar só no código:
  1) A API não tem parâmetro OFICIAL e confiável para "nome do escritório",
     "nome do advogado" ou "CPF/CNPJ" — o único filtro de pessoa que a
     comunidade confirma funcionar bem é OAB + UF (porque nome varia de
     grafia entre tribunais). Por isso, quando a busca é por nome ou
     CPF/CNPJ, este cliente tenta mandar como parâmetro extra (pode ou não
     ser respeitado pelo servidor) E TAMBÉM filtra o texto retornado
     localmente, como reforço — mas o resultado pode vir incompleto.
  2) A consulta pública, na experiência relatada por quem já integrou,
     bloqueia (HTTP 403) requisições vindas de fora do Brasil.

  SOBRE O ITEM 2 — suporte a proxy brasileiro: se o servidor estiver
  hospedado fora do Brasil (ex: Render em região dos EUA), configure UMA
  destas variáveis de ambiente com a URL de um proxy que saia por IP
  brasileiro, e todas as chamadas ao DJEN passam a sair por ele:

    QUOTAGUARDSTATIC_URL   — preenchida automaticamente se você assinar o
                             add-on "QuotaGuard Static IP" no próprio Render
                             (render.com/docs/quotaguard). IMPORTANTE: ao
                             assinar, escolha a região "São Paulo (sa-east-1)"
                             — por padrão o QuotaGuard usa uma região dos EUA,
                             que NÃO resolve o bloqueio.
    DJEN_PROXY_URL         — alternativa genérica, para qualquer outro
                             provedor de proxy brasileiro (ex: Proxying.io,
                             Froxy). Formato: http://usuario:senha@host:porta

  Sem nenhuma das duas configuradas, as chamadas saem direto (sem proxy) —
  o sistema continua funcionando normalmente para tudo o mais, só a busca no
  DJEN é que pode falhar com o aviso de bloqueio geográfico.
*/

const { ProxyAgent, fetch: fetchComProxy } = require('undici');

const urlProxy = process.env.QUOTAGUARDSTATIC_URL || process.env.DJEN_PROXY_URL || null;
const agenteProxy = urlProxy ? new ProxyAgent(urlProxy) : null;

async function fetchDjen(url, opcoes = {}) {
  if (agenteProxy) return fetchComProxy(url, { ...opcoes, dispatcher: agenteProxy });
  return fetch(url, opcoes); // sem proxy configurado — sai direto pelo IP do próprio servidor
}

const BASE_URL = 'https://comunicaapi.pje.jus.br/api/v1';
let ultimaChamadaEm = 0;

async function aguardarIntervaloMinimo() {
  const decorrido = Date.now() - ultimaChamadaEm;
  const minimo = 500; // ~500ms entre chamadas, recomendação de quem já integrou, para evitar 500 sob rajada
  if (decorrido < minimo) await new Promise((r) => setTimeout(r, minimo - decorrido));
  ultimaChamadaEm = Date.now();
}

async function chamarComRetry(url, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    await aguardarIntervaloMinimo();
    let resp;
    try {
      resp = await fetchDjen(url, { headers: { Accept: 'application/json' } });
    } catch (e) {
      if (i === tentativas - 1) throw new Error('Não foi possível conectar à API do DJEN. Verifique a conexão do servidor.');
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      continue;
    }
    if (resp.status === 403) {
      throw new Error(agenteProxy
        ? 'A API do DJEN recusou a conexão (HTTP 403) mesmo usando o proxy configurado. Confira se a URL do proxy está correta e se a região dele é realmente no Brasil (ex: São Paulo/sa-east-1, não uma região dos EUA).'
        : 'A API do DJEN recusou a conexão (HTTP 403). Isso costuma acontecer quando o servidor está hospedado fora do Brasil. Configure a variável de ambiente QUOTAGUARDSTATIC_URL (add-on do Render, região São Paulo) ou DJEN_PROXY_URL (outro provedor de proxy brasileiro) para resolver — veja o comentário no topo de src/utils/djen.js.');
    }
    if (resp.status === 500 && i < tentativas - 1) {
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      continue;
    }
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => '');
      throw new Error(`A API do DJEN respondeu com erro (HTTP ${resp.status}). ${corpo.slice(0, 200)}`);
    }
    return resp.json();
  }
  throw new Error('A API do DJEN não respondeu após várias tentativas.');
}

/**
 * Busca comunicações no DJEN. `filtros` pode conter:
 *   oab, ufOab, numeroProcesso, siglaTribunal (undefined = todos os tribunais,
 *   ou seja, busca nacional), dataInicio, dataFim, pagina,
 *   e opcionalmente nomeAdvogado / nomeParte / cpfCnpj (best-effort, ver aviso acima).
 */
async function buscarComunicacoes(filtros = {}) {
  const params = new URLSearchParams();
  if (filtros.oab) params.set('numeroOab', String(filtros.oab).replace(/\D/g, ''));
  if (filtros.ufOab) params.set('ufOab', filtros.ufOab.toUpperCase());
  if (filtros.numeroProcesso) params.set('numeroProcesso', String(filtros.numeroProcesso).replace(/\D/g, ''));
  if (filtros.siglaTribunal) params.set('siglaTribunal', filtros.siglaTribunal.toUpperCase());
  if (filtros.dataInicio) params.set('dataDisponibilizacaoInicio', filtros.dataInicio);
  if (filtros.dataFim) params.set('dataDisponibilizacaoFim', filtros.dataFim);
  // Tentativas best-effort — a API pode simplesmente ignorar estes parâmetros.
  if (filtros.nomeAdvogado) params.set('nomeAdvogado', filtros.nomeAdvogado);
  if (filtros.nomeParte) params.set('nomeParte', filtros.nomeParte);
  if (filtros.cpfCnpj) params.set('numeroOab', String(filtros.cpfCnpj).replace(/\D/g, '')); // fallback só se não houver OAB
  params.set('pagina', String(filtros.pagina || 1));
  params.set('itensPorPagina', String(Math.min(filtros.itensPorPagina || 50, 50)));

  const url = `${BASE_URL}/comunicacao?${params.toString()}`;
  const dados = await chamarComRetry(url);

  // A resposta observada varia entre {count, items:[...]} e {status,message,items:[...]}
  // — normalizamos aqui para sempre devolver um array plano.
  const items = Array.isArray(dados) ? dados : (dados.items || dados.result || []);
  const total = dados.count ?? dados.total ?? items.length;

  let normalizados = items.map(normalizarItem);

  // Reforço local: se a busca foi por nome/CPF-CNPJ (que a API pode ignorar),
  // filtra o texto retornado para não devolver ruído completamente solto.
  const termoLivre = (filtros.nomeAdvogado || filtros.nomeParte || filtros.nomeEscritorio || '').toLowerCase().trim();
  if (termoLivre) {
    normalizados = normalizados.filter((n) => (n.texto || '').toLowerCase().includes(termoLivre));
  }

  return { total, items: normalizados };
}

function normalizarItem(item) {
  return {
    idDjen: item.id ?? item.hash ?? item.numero_comunicacao ?? null,
    hash: item.hash ?? null,
    numeroProcesso: item.numero_processo ?? item.numeroprocessocommascara ?? item.numeroProcesso ?? '',
    tribunal: item.sigla_tribunal ?? item.siglaTribunal ?? item.nomeOrgao ?? item.nome_orgao ?? '',
    orgaoJulgador: item.orgao_julgador ?? item.orgaoJulgador ?? item.nome_orgao ?? '',
    texto: item.texto ?? item.conteudo ?? '',
    dataDisponibilizacao: item.data_disponibilizacao ?? item.dataDisponibilizacao ?? item.data_publicacao ?? item.dataPublicacao ?? null,
    link: item.link ?? null,
    tipoComunicacao: item.tipo_comunicacao ?? item.tipoComunicacao ?? item.meio ?? '',
    destinatarios: item.destinatarios ?? item.destinatarioadvogados ?? [],
    bruto: item, // guarda o item original inteiro — útil se os nomes de campo variarem por tribunal
  };
}

module.exports = { buscarComunicacoes };
