const express = require('express');
const bcrypt = require('bcryptjs');
const { getCollection, setCollection } = require('../utils/store');
const { requireAuth, requireRole } = require('../middleware/auth');
const { clientesVisiveis, isMaster, isSocio, isAssociado } = require('../utils/visibility');

const router = express.Router();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function onlyDigits(s) { return (s || '').replace(/\D/g, ''); }

router.get('/', requireAuth, requireRole('master', 'socio', 'associado'), async (req, res) => {
  const clientes = await getCollection('clientes', []);
  res.json(clientesVisiveis(req.user, clientes));
});

router.post('/', requireAuth, requireRole('master', 'socio', 'associado'), async (req, res) => {
  const body = req.body || {};
  if (!body.nome) return res.status(400).json({ erro: 'Informe o nome do cliente.' });
  const cpf = onlyDigits(body.cpf);
  if (cpf.length < 11) return res.status(400).json({ erro: 'Informe um CPF válido (somente números).' });

  let vinculoId = body.vinculoId;
  if (isAssociado(req.user)) vinculoId = req.user.id; // associado só cadastra para si mesmo
  if (!vinculoId) return res.status(400).json({ erro: 'Selecione a quem este cliente será vinculado.' });

  const clientes = await getCollection('clientes', []);
  if (clientes.some((c) => onlyDigits(c.cpf) === cpf)) {
    return res.status(409).json({ erro: 'Já existe um cliente com este CPF.' });
  }

  const novoCliente = {
    id: uid(),
    nome: body.nome, nacionalidade: body.nacionalidade || 'Brasileira', estadoCivil: body.estadoCivil || 'solteiro(a)',
    profissao: body.profissao || '', rg: body.rg || '', cpf,
    cep: body.cep || '', logradouro: body.logradouro || '', numero: body.numero || '', complemento: body.complemento || '',
    bairro: body.bairro || '', cidade: body.cidade || '', uf: body.uf || '',
    telefoneFixo: body.telefoneFixo || '', celular: body.celular || '',
    vinculoId, obs: body.obs || '',
  };
  clientes.push(novoCliente);
  await setCollection('clientes', clientes);

  const usuarios = await getCollection('usuarios', []);
  const senhaHash = await bcrypt.hash(cpf, 10);
  usuarios.push({
    id: uid(), tipo: 'cliente', nome: novoCliente.nome, login: cpf, senhaHash,
    mustChange: true, ativo: true, clienteId: novoCliente.id, vinculoId,
  });
  await setCollection('usuarios', usuarios);

  res.status(201).json({ cliente: novoCliente, loginGerado: cpf });
});

router.patch('/:id', requireAuth, requireRole('master', 'socio', 'associado'), async (req, res) => {
  const clientes = await getCollection('clientes', []);
  const cliente = clientes.find((c) => c.id === req.params.id);
  if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  if (isAssociado(req.user) && cliente.vinculoId !== req.user.id) {
    return res.status(403).json({ erro: 'Você só pode editar seus próprios clientes.' });
  }
  const campos = ['nome', 'nacionalidade', 'estadoCivil', 'profissao', 'rg', 'cep', 'logradouro', 'numero',
    'complemento', 'bairro', 'cidade', 'uf', 'telefoneFixo', 'celular', 'obs'];
  campos.forEach((c) => { if (req.body[c] !== undefined) cliente[c] = req.body[c]; });
  if (req.body.vinculoId !== undefined && (isMaster(req.user) || isSocio(req.user))) {
    cliente.vinculoId = req.body.vinculoId;
  }
  await setCollection('clientes', clientes);
  res.json(cliente);
});

router.delete('/:id', requireAuth, requireRole('master', 'socio', 'associado'), async (req, res) => {
  const clientes = await getCollection('clientes', []);
  const cliente = clientes.find((c) => c.id === req.params.id);
  if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  if (isAssociado(req.user) && cliente.vinculoId !== req.user.id) {
    return res.status(403).json({ erro: 'Você só pode remover seus próprios clientes.' });
  }
  await setCollection('clientes', clientes.filter((c) => c.id !== req.params.id));
  const usuarios = await getCollection('usuarios', []);
  await setCollection('usuarios', usuarios.filter((u) => u.clienteId !== req.params.id));
  res.json({ ok: true });
});

module.exports = router;
