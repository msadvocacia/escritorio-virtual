const express = require('express');
const bcrypt = require('bcryptjs');
const { getCollection, setCollection } = require('../utils/store');
const { requireAuth, requireRole } = require('../middleware/auth');
const { usuariosVisiveis, isMaster, isSocio } = require('../utils/visibility');

const router = express.Router();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function todayISOBackend() {
  return new Date().toISOString().slice(0, 10);
}

// Lista usuários (master vê todos; sócio vê todos exceto o master pode restringir se quiser)
router.get('/', requireAuth, requireRole('master', 'socio'), async (req, res) => {
  const usuarios = await getCollection('usuarios', []);
  const semClientes = usuarios.filter((u) => u.tipo !== 'cliente');
  const visiveis = req.user.tipo === 'socio' ? semClientes.filter((u) => u.tipo !== 'master') : semClientes;
  res.json(usuariosVisiveis(req.user, visiveis));
});

// Lista "básica" (só id/nome/tipo/oab/ativo, sem nenhum dado sensível) de sócios e
// associados — acessível a QUALQUER usuário autenticado (inclusive associado),
// para popular seletores como "profissional vinculado" no cadastro de processo.
// Contrato assinado (PDF escaneado, por exemplo) — só sócio/master enviam;
// o próprio usuário pode ver/baixar/imprimir o seu, mas nunca editar (é só
// um arquivo guardado, sem edição pelo sistema).
router.post('/:id/contrato-assinado', requireAuth, requireRole('master', 'socio'), async (req, res) => {
  const { nomeArquivo, conteudoBase64 } = req.body || {};
  if (!nomeArquivo || !conteudoBase64) return res.status(400).json({ erro: 'Arquivo inválido.' });
  if (conteudoBase64.length > 14 * 1024 * 1024) return res.status(413).json({ erro: 'Arquivo muito grande (máximo ~10MB).' });
  const usuarios = await getCollection('usuarios', []);
  const alvo = usuarios.find((u) => u.id === req.params.id);
  if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  alvo.contratoAssinado = { nome: nomeArquivo, conteudoBase64, enviadoPor: req.user.id, enviadoEm: new Date().toISOString() };
  await setCollection('usuarios', usuarios);
  res.json({ nome: alvo.contratoAssinado.nome, enviadoEm: alvo.contratoAssinado.enviadoEm });
});

router.get('/:id/contrato-assinado', requireAuth, async (req, res) => {
  if (!isMaster(req.user) && !isSocio(req.user) && req.user.id !== req.params.id) {
    return res.status(403).json({ erro: 'Sem acesso a este arquivo.' });
  }
  const usuarios = await getCollection('usuarios', []);
  const alvo = usuarios.find((u) => u.id === req.params.id);
  if (!alvo || !alvo.contratoAssinado) return res.status(404).json({ erro: 'Nenhum contrato assinado enviado ainda.' });
  res.json(alvo.contratoAssinado);
});

router.delete('/:id/contrato-assinado', requireAuth, requireRole('master', 'socio'), async (req, res) => {
  const usuarios = await getCollection('usuarios', []);
  const alvo = usuarios.find((u) => u.id === req.params.id);
  if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  delete alvo.contratoAssinado;
  await setCollection('usuarios', usuarios);
  res.json({ ok: true });
});

router.get('/basico', requireAuth, async (req, res) => {
  const usuarios = await getCollection('usuarios', []);
  const lista = usuarios
    .filter((u) => (u.tipo === 'socio' || u.tipo === 'associado' || u.tipo === 'estagiario') && u.ativo !== false)
    .map((u) => ({ id: u.id, nome: u.nome, tipo: u.tipo, oab: u.oab || '' }));
  res.json(lista);
});

// Cria sócio (só master) ou associado (master ou sócio)
router.post('/', requireAuth, requireRole('master', 'socio'), async (req, res) => {
  const {
    nome, tipo, login, senha, oab, nacionalidade, estadoCivil, rg, cpf, telefone, endereco, ativo, agendaPessoalLiberada,
    visualizarEstagio, remunerado, formacaoEstagiario, estagiarioVisivelPara, tutoresIds,
  } = req.body || {};
  if (!nome || !login || !tipo) return res.status(400).json({ erro: 'Preencha nome, login e perfil.' });
  if (tipo === 'socio' && !isMaster(req.user)) {
    return res.status(403).json({ erro: 'Somente o administrador master pode cadastrar sócios.' });
  }
  if (!['socio', 'associado', 'estagiario'].includes(tipo)) {
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
    agendaPessoalLiberada: (tipo === 'socio' || tipo === 'estagiario') ? true : !!agendaPessoalLiberada,
    visualizarEstagio: tipo === 'socio' || tipo === 'associado' ? !!visualizarEstagio : false,
  };
  if (tipo === 'estagiario') {
    novo.remunerado = !!remunerado;
    novo.formacaoEstagiario = ['estudante', 'bacharel'].includes(formacaoEstagiario) ? formacaoEstagiario : 'estudante';
    novo.estagiarioVisivelPara = ['socio', 'associado', 'todos'].includes(estagiarioVisivelPara) ? estagiarioVisivelPara : 'todos';
    novo.tutoresIds = Array.isArray(tutoresIds) ? tutoresIds.filter((id) => usuarios.some((u) => u.id === id && (u.tipo === 'socio' || u.tipo === 'associado'))) : [];
    novo.dataInicioEstagio = todayISOBackend();
    novo.dataFimEstagio = null;
  }
  usuarios.push(novo);
  await setCollection('usuarios', usuarios);
  const { senhaHash: _omit, ...semSenha } = novo;
  res.status(201).json(semSenha);
});

// Edita dados cadastrais (não a senha) de um sócio/associado — uso do administrador/sócio
// Anotações internas sobre um estagiário — o próprio tutor (mesmo sendo
// associado, que não tem permissão geral de editar usuários) pode escrever
// aqui, já que é uma percepção pessoal dele sobre quem ele supervisiona, não
// uma alteração de cadastro. Nunca visível para o próprio estagiário.
router.patch('/:id/anotacoes', requireAuth, async (req, res) => {
  const usuarios = await getCollection('usuarios', []);
  const alvo = usuarios.find((u) => u.id === req.params.id && u.tipo === 'estagiario');
  if (!alvo) return res.status(404).json({ erro: 'Estagiário não encontrado.' });
  const souTutor = (alvo.tutoresIds || []).includes(req.user.id);
  if (!isMaster(req.user) && !isSocio(req.user) && !souTutor) {
    return res.status(403).json({ erro: 'Só sócio, administrador ou o tutor direto podem anotar sobre este estagiário.' });
  }
  alvo.anotacoesInternas = String(req.body.anotacoesInternas || '');
  await setCollection('usuarios', usuarios);
  res.json({ anotacoesInternas: alvo.anotacoesInternas });
});

router.patch('/:id', requireAuth, requireRole('master', 'socio'), async (req, res) => {
  const usuarios = await getCollection('usuarios', []);
  const usuario = usuarios.find((u) => u.id === req.params.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (usuario.tipo === 'master') return res.status(403).json({ erro: 'O administrador master não pode ser editado por aqui.' });
  const campos = ['nome', 'oab', 'ativo', 'nacionalidade', 'estadoCivil', 'rg', 'cpf', 'telefone', 'endereco', 'agendaPessoalLiberada', 'visualizarEstagio', 'remunerado', 'formacaoEstagiario', 'estagiarioVisivelPara', 'tutoresIds', 'dataFimEstagio', 'relatorioLiberado', 'certificadoLiberado'];
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

// Exclui QUALQUER usuário (cliente, associado ou sócio) — exclusivo do administrador master.
router.delete('/:id', requireAuth, requireRole('master'), async (req, res) => {
  const usuarios = await getCollection('usuarios', []);
  const usuario = usuarios.find((u) => u.id === req.params.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (usuario.tipo === 'master') return res.status(403).json({ erro: 'O administrador master não pode ser excluído.' });

  await setCollection('usuarios', usuarios.filter((u) => u.id !== req.params.id));

  // Se for um usuário do tipo cliente, remove também o cadastro correspondente na coleção de clientes.
  if (usuario.tipo === 'cliente' && usuario.clienteId) {
    const clientes = await getCollection('clientes', []);
    await setCollection('clientes', clientes.filter((c) => c.id !== usuario.clienteId));
  }
  res.json({ ok: true });
});

module.exports = router;
