const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getCollection, setCollection } = require('../utils/store');
const { requireAuth } = require('../middleware/auth');
const { semSenha } = require('../utils/visibility');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { login, senha } = req.body || {};
  if (!login || !senha) return res.status(400).json({ erro: 'Informe login e senha.' });

  const usuarios = await getCollection('usuarios', []);
  const usuario = usuarios.find(
    (u) => u.login && u.login.toLowerCase() === String(login).toLowerCase() && u.ativo !== false
  );
  if (!usuario) return res.status(401).json({ erro: 'Login ou senha inválidos.' });

  const ok = await bcrypt.compare(senha, usuario.senhaHash || '');
  if (!ok) return res.status(401).json({ erro: 'Login ou senha inválidos.' });

  const payload = {
    id: usuario.id,
    tipo: usuario.tipo,
    nome: usuario.nome,
    clienteId: usuario.clienteId || null,
    vinculoId: usuario.vinculoId || null,
    mustChange: !!usuario.mustChange,
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, usuario: semSenha(usuario) });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { novaSenha } = req.body || {};
  if (!novaSenha || novaSenha.length < 4) {
    return res.status(400).json({ erro: 'A nova senha deve ter ao menos 4 caracteres.' });
  }
  const usuarios = await getCollection('usuarios', []);
  const usuario = usuarios.find((u) => u.id === req.user.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  usuario.senhaHash = await bcrypt.hash(novaSenha, 10);
  usuario.mustChange = false;
  await setCollection('usuarios', usuarios);
  res.json({ ok: true });
});

module.exports = router;
