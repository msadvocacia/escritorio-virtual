const express = require('express');
const { getCollection, setCollection } = require('../utils/store');
const { requireAuth } = require('../middleware/auth');
const { mergeCollection } = require('../utils/merge');
const V = require('../utils/visibility');

const router = express.Router();

// Config de cada coleção "simples": como filtrar na leitura, e quais outras
// coleções precisam ser carregadas para calcular visibilidade/posse.
const CONFIGS = {
  processos: {
    ctx: ['clientes'],
    visivel: (user, data, ctx) => V.processosVisiveis(user, data, ctx.clientes),
  },
  prazos: {
    ctx: ['clientes', 'processos'],
    visivel: (user, data, ctx) => V.prazosVisiveis(user, data, ctx.processos, ctx.clientes),
  },
  audiencias: {
    ctx: ['clientes', 'processos'],
    visivel: (user, data, ctx) => V.audienciasVisiveis(user, data, ctx.processos, ctx.clientes),
  },
  honorarios: {
    ctx: ['clientes'],
    visivel: (user, data, ctx) => V.honorariosVisiveis(user, data, ctx.clientes),
  },
  despesas: {
    ctx: [],
    visivel: (user, data) => V.despesasVisiveis(user, data),
  },
  lembretes: {
    ctx: [],
    visivel: (user, data) => V.lembretesVisiveis(user, data),
  },
  disponibilidades: {
    ctx: [],
    visivel: (user, data) => V.disponibilidadesVisiveis(user, data),
  },
  agendamentos: {
    ctx: [],
    visivel: (user, data) => V.agendamentosVisiveis(user, data),
  },
  mensagens: {
    ctx: [],
    visivel: (user, data) => V.mensagensVisiveis(user, data),
  },
};

async function carregarContexto(nomes) {
  const ctx = {};
  for (const nome of nomes) {
    ctx[nome] = await getCollection(nome, []);
  }
  return ctx;
}

router.get('/:nome', requireAuth, async (req, res) => {
  const { nome } = req.params;
  const config = CONFIGS[nome];
  if (!config) return res.status(404).json({ erro: 'Coleção não encontrada.' });

  const data = await getCollection(nome, []);
  const ctx = await carregarContexto(config.ctx);
  if (ctx.clientes) ctx.clientesIds = V.clientesVisiveis(req.user, ctx.clientes).map((c) => c.id);

  res.json(config.visivel(req.user, data, ctx));
});

router.put('/:nome', requireAuth, async (req, res) => {
  const { nome } = req.params;
  const config = CONFIGS[nome];
  if (!config) return res.status(404).json({ erro: 'Coleção não encontrada.' });
  if (!Array.isArray(req.body)) return res.status(400).json({ erro: 'Corpo da requisição deve ser um array.' });

  const existentes = await getCollection(nome, []);
  const ctx = await carregarContexto(['clientes', 'processos', 'usuarios']);
  ctx.clientesIds = V.clientesVisiveis(req.user, ctx.clientes || []).map((c) => c.id);

  const final = mergeCollection(nome, existentes, req.body, req.user, ctx);
  await setCollection(nome, final);
  res.json(final);
});

module.exports = router;
