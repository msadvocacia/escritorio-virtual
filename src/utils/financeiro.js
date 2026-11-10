// Lê a lista de profissionais vinculados a um processo/honorário, com
// compatibilidade para registros antigos que ainda usam os campos
// associadoId/associadoId2 (modelo anterior, de no máximo 2 pessoas).
function idsProfissionais(registro) {
  if (Array.isArray(registro.profissionaisIds) && registro.profissionaisIds.length) {
    return registro.profissionaisIds;
  }
  const arr = [];
  if (registro.associadoId) arr.push(registro.associadoId);
  if (registro.associadoId2) arr.push(registro.associadoId2);
  return arr;
}

function partesSplit(splitTipo) {
  switch (splitTipo) {
    case 'associado_70_30': return { profissional: 0.7, escritorio: 0.3 };
    case 'associado_60_40': return { profissional: 0.6, escritorio: 0.4 };
    case 'associado_50_50': return { profissional: 0.5, escritorio: 0.5 };
    case 'associado_50_socio_30_escritorio_20': return { profissional: 0.5, socio: 0.3, escritorio: 0.2 };
    case 'associado_40_socio_40_escritorio_20': return { profissional: 0.4, socio: 0.4, escritorio: 0.2 };
    case 'dois_associados_50_50': return { profissional: 1 }; // 100% dividido entre os profissionais selecionados, nada para o escritório
    default: return { escritorio: 1 };
  }
}

function valorRecebidoHonorario(h) {
  if (h.forma === 'avista') return h.avistaStatus === 'pago' ? h.valorTotal : 0;
  return (h.parcelas || []).filter((p) => p.status === 'pago').reduce((s, p) => s + p.valor, 0);
}

function dentroPeriodo(dataStr, periodo) {
  if (!periodo) return true;
  return dataStr >= periodo.inicio && dataStr <= periodo.fim;
}

function fracaoEscritorio(h) {
  const ids = idsProfissionais(h);
  if (!ids.length) return 1;
  const partes = partesSplit(h.splitTipo);
  // Só a fatia "escritório" entra no caixa institucional; a fatia de "sócio" (splits que a têm)
  // pertence ao sócio responsável — mesma regra usada na tela (Financeiro).
  return partes.escritorio || 0;
}

/**
 * Quanto, do valor já recebido, cabe a UM profissional específico. Mesma regra da tela:
 * a fatia "profissional" é dividida entre os ASSOCIADOS vinculados e a fatia "sócio" (nos splits que a
 * têm) entre os SÓCIOS vinculados. Sem a lista de usuários, cai na divisão antiga (igual entre todos).
 */
function parteDoProfissional(h, usuarioId, usuarios) {
  const ids = idsProfissionais(h);
  if (!ids.includes(usuarioId) || ids.length === 0) return 0;
  const partes = partesSplit(h.splitTipo);
  const recebido = valorRecebidoHonorario(h);
  if (!Array.isArray(usuarios)) return (recebido * (partes.profissional || 0)) / ids.length;
  const tipoDe = (id) => { const u = usuarios.find((x) => x.id === id); return u ? u.tipo : null; };
  const assoc = ids.filter((id) => tipoDe(id) === 'associado');
  const socios = ids.filter((id) => tipoDe(id) === 'socio');
  if (tipoDe(usuarioId) === 'associado') return (recebido * (partes.profissional || 0)) / assoc.length;
  if (tipoDe(usuarioId) === 'socio') return (recebido * (partes.socio || 0)) / socios.length;
  return 0;
}

/** Resumo do relatório para master/sócio (visão do escritório). */
function resumoEscritorio(honorarios, despesas, periodo) {
  let recebidoPeriodo = 0;
  honorarios.forEach((h) => {
    const fracao = fracaoEscritorio(h);
    if (h.forma === 'avista') {
      if (h.avistaStatus === 'pago' && h.avistaPagoEm && dentroPeriodo(h.avistaPagoEm, periodo)) recebidoPeriodo += h.valorTotal * fracao;
    } else {
      (h.parcelas || []).forEach((p) => {
        if (p.status === 'pago' && p.pagoEm && dentroPeriodo(p.pagoEm, periodo)) recebidoPeriodo += p.valor * fracao;
      });
    }
  });
  const despesasPeriodo = despesas.filter((d) => dentroPeriodo(d.data, periodo)).reduce((s, d) => s + d.valor, 0);
  const totalRecebidoHistorico = honorarios.reduce((s, h) => s + valorRecebidoHonorario(h) * fracaoEscritorio(h), 0);
  const totalDespesas = despesas.reduce((s, d) => s + d.valor, 0);
  return {
    recebidoPeriodo, despesasPeriodo, saldoPeriodo: recebidoPeriodo - despesasPeriodo,
    caixaAcumulado: totalRecebidoHistorico - totalDespesas,
  };
}

/** Totais do relatório para um profissional (sócio ou associado) olhando só os processos em que ele está vinculado. */
function totaisAssociado(honorariosDoProfissional, userId, usuarios) {
  let totalContrato = 0, totalRecebidoCliente = 0, minhaParteRepassada = 0, minhaParteAguardando = 0;
  honorariosDoProfissional.forEach((h) => {
    const minhaParte = parteDoProfissional(h, userId, usuarios);
    totalContrato += h.valorTotal;
    totalRecebidoCliente += valorRecebidoHonorario(h);
    if (h.repasseStatus === 'confirmado') minhaParteRepassada += minhaParte;
    else minhaParteAguardando += minhaParte;
  });
  return { totalContrato, totalRecebidoCliente, minhaParteRepassada, minhaParteAguardando };
}

module.exports = {
  idsProfissionais, partesSplit, valorRecebidoHonorario, fracaoEscritorio, parteDoProfissional,
  resumoEscritorio, totaisAssociado,
};
