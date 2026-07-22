const express = require('express');
const { getCollection } = require('../utils/store');
const { requireAuth } = require('../middleware/auth');
const { gerarHorarios } = require('../utils/schedule');
const { semSenha, isCliente } = require('../utils/visibility');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const usuarios = await getCollection('usuarios', []);
  const usuario = usuarios.find((u) => u.id === req.user.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  res.json(semSenha(usuario));
});

router.get('/cliente', requireAuth, async (req, res) => {
  if (!isCliente(req.user)) return res.status(403).json({ erro: 'Rota exclusiva do perfil cliente.' });
  const clientes = await getCollection('clientes', []);
  const meu = clientes.find((c) => c.id === req.user.clienteId);
  if (!meu) return res.status(404).json({ erro: 'Cadastro de cliente não encontrado.' });
  res.json(meu);
});

router.get('/processos', requireAuth, async (req, res) => {
  if (!isCliente(req.user)) return res.status(403).json({ erro: 'Rota exclusiva do perfil cliente.' });
  const processos = await getCollection('processos', []);
  res.json(processos.filter((p) => p.clienteId === req.user.clienteId));
});

// Com quem este cliente pode agendar: o próprio vínculo, e sócios (se o vínculo for um associado).
router.get('/opcoes-agendamento', requireAuth, async (req, res) => {
  if (!isCliente(req.user)) return res.status(403).json({ erro: 'Rota exclusiva do perfil cliente.' });
  const usuarios = await getCollection('usuarios', []);
  const vinculado = usuarios.find((u) => u.id === req.user.vinculoId);
  let opcoes = [];
  if (vinculado) {
    if (vinculado.tipo === 'associado') {
      opcoes = [vinculado, ...usuarios.filter((u) => u.tipo === 'socio' && u.ativo !== false)];
    } else {
      opcoes = [vinculado];
    }
  }
  res.json(opcoes.map((u) => ({ id: u.id, nome: u.nome, tipo: u.tipo })));
});

router.get('/disponibilidade/:usuarioId/:data', requireAuth, async (req, res) => {
  if (!isCliente(req.user)) return res.status(403).json({ erro: 'Rota exclusiva do perfil cliente.' });
  const usuarios = await getCollection('usuarios', []);
  const vinculado = usuarios.find((u) => u.id === req.user.vinculoId);
  const permitido = new Set();
  if (vinculado) {
    permitido.add(vinculado.id);
    if (vinculado.tipo === 'associado') {
      usuarios.filter((u) => u.tipo === 'socio' && u.ativo !== false).forEach((u) => permitido.add(u.id));
    }
  }
  if (!permitido.has(req.params.usuarioId)) {
    return res.status(403).json({ erro: 'Você não pode agendar com este profissional.' });
  }
  const disponibilidades = await getCollection('disponibilidades', []);
  const agendamentos = await getCollection('agendamentos', []);
  const horarios = gerarHorarios(req.params.usuarioId, req.params.data, disponibilidades, agendamentos);
  res.json(horarios.map(({ hora, ocupado }) => ({ hora, ocupado })));
});

module.exports = router;
