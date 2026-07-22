// Regras de visibilidade por perfil, espelhando as mesmas regras que existiam
// no protótipo (frontend), mas agora aplicadas no servidor -- o que é o ganho real
// de segurança desta migração: um cliente autenticado nunca recebe dados de outros
// clientes, sócios ou associados, porque o próprio servidor filtra antes de responder.

function isMaster(user) { return user && user.tipo === 'master'; }
function isSocio(user) { return user && user.tipo === 'socio'; }
function isAssociado(user) { return user && user.tipo === 'associado'; }
function isCliente(user) { return user && user.tipo === 'cliente'; }
function isStaff(user) { return isMaster(user) || isSocio(user) || isAssociado(user); }
function podeVerCaixa(user) { return isMaster(user) || isSocio(user); }

// Remove sempre o hash de senha antes de qualquer envio ao cliente.
function semSenha(usuario) {
  if (!usuario) return usuario;
  const { senhaHash, ...resto } = usuario;
  return resto;
}

function clientesVisiveis(user, clientes) {
  if (isMaster(user) || isSocio(user)) return clientes;
  if (isAssociado(user)) return clientes.filter((c) => c.vinculoId === user.id);
  return [];
}

function idsClientesDoUsuario(user, clientes) {
  return clientesVisiveis(user, clientes).map((c) => c.id);
}

function processosVisiveis(user, processos, clientes) {
  if (isMaster(user) || isSocio(user)) return processos;
  if (isAssociado(user)) {
    const idsClientes = idsClientesDoUsuario(user, clientes);
    return processos.filter((p) => p.associadoId === user.id || idsClientes.includes(p.clienteId));
  }
  if (isCliente(user)) {
    return processos.filter((p) => p.clienteId === user.clienteId);
  }
  return [];
}

function honorariosVisiveis(user, honorarios, clientes) {
  if (isMaster(user) || isSocio(user)) return honorarios;
  if (isAssociado(user)) {
    const idsClientes = idsClientesDoUsuario(user, clientes);
    return honorarios.filter((h) => idsClientes.includes(h.clienteId) || h.associadoId === user.id);
  }
  if (isCliente(user)) {
    return honorarios.filter((h) => h.clienteId === user.clienteId);
  }
  return [];
}

function despesasVisiveis(user, despesas) {
  return podeVerCaixa(user) ? despesas : [];
}

function usuariosVisiveis(user, usuarios) {
  if (isMaster(user)) return usuarios.map(semSenha);
  if (isSocio(user)) return usuarios.map(semSenha);
  return [];
}

function prazosVisiveis(user, prazos, processos, clientes) {
  if (isMaster(user) || isSocio(user)) return prazos;
  const idsProc = processosVisiveis(user, processos, clientes).map((p) => p.id);
  return prazos.filter((pr) => !pr.processoId || idsProc.includes(pr.processoId));
}

function audienciasVisiveis(user, audiencias, processos, clientes) {
  const idsProc = processosVisiveis(user, processos, clientes).map((p) => p.id);
  if (isMaster(user) || isSocio(user)) return audiencias;
  return audiencias.filter((a) => idsProc.includes(a.processoId));
}

function lembretesVisiveis(user, lembretes) {
  if (isStaff(user)) return lembretes;
  return [];
}

function disponibilidadesVisiveis(user, disponibilidades) {
  if (isMaster(user)) return disponibilidades;
  if (isSocio(user) || isAssociado(user)) return disponibilidades.filter((d) => d.usuarioId === user.id);
  return [];
}

function agendamentosVisiveis(user, agendamentos) {
  if (isMaster(user)) return agendamentos;
  if (isSocio(user) || isAssociado(user)) return agendamentos.filter((a) => a.usuarioId === user.id);
  if (isCliente(user)) return agendamentos.filter((a) => a.clienteId === user.clienteId);
  return [];
}

function mensagensVisiveis(user, mensagens) {
  if (isMaster(user) || isSocio(user)) return mensagens;
  if (isAssociado(user)) return mensagens.filter((m) => m.usuarioId === user.id);
  if (isCliente(user)) return mensagens.filter((m) => m.clienteId === user.clienteId);
  return [];
}

module.exports = {
  isMaster, isSocio, isAssociado, isCliente, isStaff, podeVerCaixa, semSenha,
  clientesVisiveis, processosVisiveis, honorariosVisiveis, despesasVisiveis,
  usuariosVisiveis, prazosVisiveis, audienciasVisiveis, lembretesVisiveis,
  disponibilidadesVisiveis, agendamentosVisiveis, mensagensVisiveis,
};
