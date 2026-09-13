const express = require('express');
const { getCollection, setCollection } = require('../utils/store');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Regra de visibilidade DIFERENTE do resto do sistema: aqui nem sócio vê a
// agenda de outro sócio — só o próprio dono. Só o Administrador Master
// enxerga a agenda de qualquer usuário (todo mundo abaixo dele).
function podeVerRegistro(user, registro) {
  if (user.tipo === 'master') return true;
  return registro.usuarioId === user.id;
}

// Lista de usuários (sócios + associados) para o Master escolher de quem ver
// a agenda — mostra todos, mesmo que o associado não tenha "liberada" (o
// acesso do Master não depende dessa liberação, que é só para o próprio
// associado enxergar a aba dele).
router.get('/usuarios', requireAuth, requireRole('master'), async (req, res) => {
  const usuarios = await getCollection('usuarios', []);
  const lista = usuarios
    .filter((u) => u.tipo === 'socio' || u.tipo === 'associado')
    .map((u) => ({ id: u.id, nome: u.nome, tipo: u.tipo }));
  res.json(lista);
});

// Lista os registros — do próprio usuário, ou (se ?usuarioId= for passado e
// quem pede for o Master) de um usuário específico.
router.get('/', requireAuth, async (req, res) => {
  const todos = await getCollection('agendaPessoal', []);
  if (req.user.tipo === 'master' && req.query.usuarioId) {
    return res.json(todos.filter((r) => r.usuarioId === req.query.usuarioId));
  }
  if (req.user.tipo === 'master') {
    return res.status(400).json({ erro: 'Informe ?usuarioId= para ver a agenda de um usuário específico.' });
  }
  if (req.user.tipo !== 'socio' && req.user.tipo !== 'associado') {
    return res.status(403).json({ erro: 'Sem acesso à agenda pessoal.' });
  }
  res.json(todos.filter((r) => r.usuarioId === req.user.id));
});

router.post('/', requireAuth, async (req, res) => {
  const usuarios = await getCollection('usuarios', []);
  const eu = usuarios.find((u) => u.id === req.user.id);
  // Dono do novo registro: o próprio usuário, OU — se for o Master — o
  // usuarioId informado no corpo (Master pode lançar algo na agenda de quem
  // está acompanhando).
  let usuarioIdAlvo = req.user.id;
  if (req.user.tipo === 'master' && req.body.usuarioId) {
    usuarioIdAlvo = req.body.usuarioId;
  } else if (req.user.tipo === 'associado' && eu && !eu.agendaPessoalLiberada) {
    return res.status(403).json({ erro: 'Sua agenda pessoal ainda não foi liberada por um sócio ou pelo administrador.' });
  } else if (req.user.tipo !== 'socio' && req.user.tipo !== 'associado' && req.user.tipo !== 'master') {
    return res.status(403).json({ erro: 'Sem acesso à agenda pessoal.' });
  }
  const { clienteNome, numeroProcesso, tipoProcesso, valorCausa, audienciaData, audienciaHora, audienciaLembrete, prazoDescricao, prazoData, prazoLembrete, obs } = req.body || {};
  const novo = {
    id: uid(), usuarioId: usuarioIdAlvo, criadoPor: req.user.id,
    clienteNome: clienteNome || '', numeroProcesso: numeroProcesso || '', tipoProcesso: tipoProcesso || '',
    valorCausa: valorCausa || null,
    audienciaData: audienciaData || null, audienciaHora: audienciaHora || null, audienciaLembrete: !!audienciaLembrete,
    prazoDescricao: prazoDescricao || '', prazoData: prazoData || null, prazoLembrete: !!prazoLembrete,
    obs: obs || '', concluido: false,
  };
  const todos = await getCollection('agendaPessoal', []);
  todos.push(novo);
  await setCollection('agendaPessoal', todos);
  res.status(201).json(novo);
});

router.put('/:id', requireAuth, async (req, res) => {
  const todos = await getCollection('agendaPessoal', []);
  const registro = todos.find((r) => r.id === req.params.id);
  if (!registro) return res.status(404).json({ erro: 'Registro não encontrado.' });
  if (!podeVerRegistro(req.user, registro)) return res.status(403).json({ erro: 'Sem acesso a este registro.' });
  const campos = ['clienteNome', 'numeroProcesso', 'tipoProcesso', 'valorCausa', 'audienciaData', 'audienciaHora', 'audienciaLembrete', 'prazoDescricao', 'prazoData', 'prazoLembrete', 'obs', 'concluido'];
  campos.forEach((c) => { if (req.body[c] !== undefined) registro[c] = req.body[c]; });
  await setCollection('agendaPessoal', todos);
  res.json(registro);
});

router.delete('/:id', requireAuth, async (req, res) => {
  const todos = await getCollection('agendaPessoal', []);
  const registro = todos.find((r) => r.id === req.params.id);
  if (!registro) return res.status(404).json({ erro: 'Registro não encontrado.' });
  if (!podeVerRegistro(req.user, registro)) return res.status(403).json({ erro: 'Sem acesso a este registro.' });
  await setCollection('agendaPessoal', todos.filter((r) => r.id !== req.params.id));
  res.json({ ok: true });
});

module.exports = router;
