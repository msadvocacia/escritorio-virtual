const { isMaster, isSocio, isAssociado, isCliente } = require('./visibility');

/*
  O painel (frontend) sempre trabalha com o array inteiro de uma coleção em memória
  e, ao salvar, reenvia o array inteiro. Isso é simples, mas perigoso num servidor
  multiusuário: um associado poderia, em teoria, reenviar um array alterado que
  também mexesse em registros de outras pessoas.

  Para impedir isso, cada coleção tem um "predicado de posse": uma função que diz
  se um determinado registro pertence (ou pode ser criado/editado) por aquele usuário.
  Ao salvar, o servidor faz:

    resultado = [registros existentes que NÃO pertencem a este usuário, intocados]
              + [registros que pertencem a este usuário, na versão que ele enviou]

  Ou seja: cada usuário só consegue mesmo alterar a "fatia" da coleção que é dele.
  Master e sócio, que already têm acesso total, apenas sobrescrevem a coleção inteira
  (é o comportamento equivalente ao que já existia, sem necessidade de filtragem).
*/

function full(user) { return isMaster(user) || isSocio(user); }

const PREDICADOS = {
  usuarios: () => () => false, // apenas master/sócio (tratado como `full`); ninguém mais grava aqui
  clientes: (user) => (registro) => registro.vinculoId === user.id,
  processos: (user, ctx) => (registro) => {
    if (registro.associadoId === user.id) return true;
    const idsClientes = (ctx.clientes || []).filter((c) => c.vinculoId === user.id).map((c) => c.id);
    return idsClientes.includes(registro.clienteId);
  },
  prazos: (user, ctx) => (registro) => {
    const idsProc = (ctx.processos || [])
      .filter((p) => p.associadoId === user.id || (ctx.clientesIds || []).includes(p.clienteId))
      .map((p) => p.id);
    return idsProc.includes(registro.processoId);
  },
  audiencias: (user, ctx) => (registro) => {
    const idsProc = (ctx.processos || [])
      .filter((p) => p.associadoId === user.id || (ctx.clientesIds || []).includes(p.clienteId))
      .map((p) => p.id);
    return idsProc.includes(registro.processoId);
  },
  honorarios: (user, ctx) => (registro) => registro.associadoId === user.id || (ctx.clientesIds || []).includes(registro.clienteId),
  despesas: () => () => false, // apenas master/sócio
  lembretes: (user) => () => !isCliente(user), // qualquer membro da equipe pode mexer (lista compartilhada)
  disponibilidades: (user) => (registro) => registro.usuarioId === user.id,
  agendamentos: (user) => (registro) => {
    if (isCliente(user)) return registro.clienteId === user.clienteId;
    return registro.usuarioId === user.id;
  },
  mensagens: (user) => (registro) => {
    if (isCliente(user)) return registro.clienteId === user.clienteId;
    return registro.usuarioId === user.id;
  },
  config: () => () => false, // apenas master/sócio
};

/**
 * Mescla o array existente com o array recebido do cliente, respeitando a posse
 * de cada registro. Retorna o array final que deve ser salvo.
 */
function mergeCollection(name, existentes, recebidos, user, ctx) {
  if (full(user)) return recebidos; // master/sócio: acesso completo, comportamento antigo preservado

  const gerarPredicado = PREDICADOS[name];
  if (!gerarPredicado) return existentes; // coleção desconhecida: não altera nada, por segurança

  const dono = gerarPredicado(user, ctx);
  const idsRecebidosPermitidos = new Set(recebidos.filter(dono).map((r) => r.id));

  const mantidos = existentes.filter((r) => !dono(r)); // tudo que NÃO é do usuário, intocado
  const doUsuario = recebidos.filter((r) => dono(r) && idsRecebidosPermitidos.has(r.id));

  return [...mantidos, ...doUsuario];
}

module.exports = { mergeCollection, full };
