const express = require('express');
const bcrypt = require('bcryptjs');
const { getCollection, setCollection } = require('../utils/store');
const { requireAuth, requireRole } = require('../middleware/auth');
const { usuariosVisiveis, isMaster } = require('../utils/visibility');

const router = express.Router();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Lista usuários (master vê todos; sócio vê todos exceto o master pode restringir se quiser)
router.get('/', requireAuth, requireRole('master', 'socio'), async (req, res) => {
  const usuarios = await getCollection('usuarios', []);
  const semClientes = usuarios.filter((u) => u.tipo !== 'cliente');
  const visiveis = req.user.tipo === 'socio' ? semClientes.filter((u) => u.tipo !== 'master') : semClientes;
  res.json(usuariosVisiveis(req.user, visiveis));
});

// Cria sócio (só master) ou associado (master ou sócio)
router.post('/', requireAuth, requireRole('master', 'socio'), async (req, res) => {
  const { nome, tipo, login, senha, oab, nacionalidade, estadoCivil, rg, cpf, telefone, endereco, ativo } = req.body || {};
  if (!nome || !login || !tipo) return res.status(400).json({ erro: 'Preencha nome, login e perfil.' });
  if (tipo === 'socio' && !isMaster(req.user)) {
    return res.status(403).json({ erro: 'Somente o administrador master pode cadastrar sócios.' });
  }
  if (!['socio', 'associado'].includes(tipo)) {
    return res.status(400).json({ erro: 'Perfil inválido.' });
  }
  const usuarios = await getCollection('usuarios', []);
  if (usuarios.some((u) => u.login.toLowerCase() === String(login).toLowerCase())) {
    return res.status(409).json({ erro: 'Já existe um usuário com este login.' });
  }
  const senhaHash = await bcrypt.hash(senha || '123456', 10);
  const novo = {
    id: uid(), tipo, nome, login, senhaHash, mustChange: true, ativo: ativo !== false,
    oab: oab || '', nacionalidade: nacionalidade || 'brasileiro(a)', estadoCivil: estadoCivil || 'solteiro(a)',
    rg: rg || '', cpf: cpf || '', telefone: telefone || '', endereco: endereco || '', vinculoId: null, clienteId: null,
  };
  usuarios.push(novo);
  await setCollection('usuarios', usuarios);
  const { senhaHash: _omit, ...semSenha } = novo;
  res.status(201).json(semSenha);
});

// Edita dados cadastrais (não a senha) de um sócio/associado — uso do administrador/sócio
router.patch('/:id', requireAuth, requireRole('master', 'socio'), async (req, res) => {
  const usuarios = await getCollection('usuarios', []);
  const usuario = usuarios.find((u) => u.id === req.params.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (usuario.tipo === 'master') return res.status(403).json({ erro: 'O administrador master não pode ser editado por aqui.' });
  const campos = ['nome', 'oab', 'ativo', 'nacionalidade', 'estadoCivil', 'rg', 'cpf', 'telefone', 'endereco'];
  campos.forEach((c) => { if (req.body[c] !== undefined) usuario[c] = req.body[c]; });
  await setCollection('usuarios', usuarios);
  const { senhaHash, ...semSenha } = usuario;
  res.json(semSenha);
});

// Autoatendimento: qualquer usuário logado (sócio, associado ou master) pode editar
// os PRÓPRIOS telefone e endereço. Nome, RG, CPF e situação ativo/inativo continuam
// a cargo exclusivo do administrador/sócio (rota acima).
router.patch('/me/contato', requireAuth, async (req, res) => {
  const usuarios = await getCollection('usuarios', []);
  const usuario = usuarios.find((u) => u.id === req.user.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (req.body.telefone !== undefined) usuario.telefone = req.body.telefone;
  if (req.body.endereco !== undefined) usuario.endereco = req.body.endereco;
  await setCollection('usuarios', usuarios);
  const { senhaHash, ...semSenha } = usuario;
  res.json(semSenha);
});

// Redefine a senha de qualquer usuário (exceto master) para uma senha temporária
router.post('/:id/reset-password', requireAuth, requireRole('master', 'socio'), async (req, res) => {
  const { novaSenha } = req.body || {};
  const usuarios = await getCollection('usuarios', []);
  const usuario = usuarios.find((u) => u.id === req.params.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (usuario.tipo === 'master') return res.status(403).json({ erro: 'Não é possível redefinir a senha do administrador master por aqui.' });
  usuario.senhaHash = await bcrypt.hash(novaSenha || '123456', 10);
  usuario.mustChange = true;
  await setCollection('usuarios', usuarios);
  res.json({ ok: true });
});

router.post('/:id/toggle-ativo', requireAuth, requireRole('master', 'socio'), async (req, res) => {
  const usuarios = await getCollection('usuarios', []);
  const usuario = usuarios.find((u) => u.id === req.params.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (usuario.tipo === 'master') return res.status(403).json({ erro: 'O administrador master não pode ser desativado.' });
  usuario.ativo = usuario.ativo === false ? true : false;
  await setCollection('usuarios', usuarios);
  res.json({ ativo: usuario.ativo });
});

module.exports = router;
