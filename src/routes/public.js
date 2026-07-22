const express = require('express');
const { getCollection, setCollection } = require('../utils/store');
const { gerarHorarios } = require('../utils/schedule');

const router = express.Router();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function idsSociosAtivos() {
  const usuarios = await getCollection('usuarios', []);
  return usuarios.filter((u) => u.tipo === 'socio' && u.ativo !== false).map((u) => u.id);
}

// Horários livres num dia, somando a agenda de todos os sócios — sem revelar quem é quem.
router.get('/disponibilidade/:data', async (req, res) => {
  const ids = await idsSociosAtivos();
  const disponibilidades = await getCollection('disponibilidades', []);
  const agendamentos = await getCollection('agendamentos', []);
  const horarios = gerarHorarios(ids, req.params.data, disponibilidades, agendamentos);
  res.json(horarios.map(({ hora, ocupado }) => ({ hora, ocupado }))); // nunca envia usuariosLivres ao público
});

router.post('/agendamentos', async (req, res) => {
  const { nome, telefone, data, hora } = req.body || {};
  if (!nome || !telefone || !data || !hora) {
    return res.status(400).json({ erro: 'Preencha nome, telefone, dia e horário.' });
  }
  const ids = await idsSociosAtivos();
  const disponibilidades = await getCollection('disponibilidades', []);
  const agendamentos = await getCollection('agendamentos', []);
  const horarios = gerarHorarios(ids, data, disponibilidades, agendamentos);
  const escolhido = horarios.find((h) => h.hora === hora);
  if (!escolhido || escolhido.ocupado) {
    return res.status(409).json({ erro: 'Esse horário acabou de ser reservado. Escolha outro.' });
  }
  const usuarioId = escolhido.usuariosLivres[0];
  agendamentos.push({
    id: uid(), usuarioId, data, hora, clienteId: null, nomePublico: nome, telefonePublico: telefone,
    status: 'solicitado', origem: 'publico',
  });
  await setCollection('agendamentos', agendamentos);
  res.status(201).json({ ok: true });
});

module.exports = router;
