// Gera os horários de meia em meia hora, a partir dos blocos de disponibilidade
// cadastrados, e marca quais já estão ocupados por agendamentos existentes.
// Aceita uma LISTA de usuarioIds (para o agendamento público, que soma a agenda
// de todos os sócios sem revelar qual deles atenderá).
function gerarHorarios(usuarioIds, dataIso, disponibilidades, agendamentos) {
  const ids = Array.isArray(usuarioIds) ? usuarioIds : [usuarioIds];
  const horariosSet = new Set();

  ids.forEach((uid) => {
    disponibilidades
      .filter((d) => d.usuarioId === uid && d.data === dataIso)
      .forEach((b) => {
        const [h, mi] = b.inicio.split(':').map(Number);
        const [hf, mf] = b.fim.split(':').map(Number);
        let cur = h * 60 + mi;
        const fim = hf * 60 + mf;
        while (cur < fim) {
          horariosSet.add(`${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`);
          cur += 30;
        }
      });
  });

  const horarios = [...horariosSet].sort();
  return horarios.map((hora) => {
    const usuariosLivres = ids.filter((uid) => {
      const ocupado = agendamentos.some(
        (a) => a.usuarioId === uid && a.data === dataIso && a.hora === hora && a.status !== 'cancelado'
      );
      return !ocupado;
    });
    return { hora, ocupado: usuariosLivres.length === 0, usuariosLivres };
  });
}

module.exports = { gerarHorarios };
