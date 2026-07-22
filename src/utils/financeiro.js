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
  return 1 - (partes.profissional || 0);
}

/** Quanto, do valor já recebido, cabe a UM profissional específico (a divisão é igual entre todos os vinculados). */
function parteDoProfissional(h, usuarioId) {
  const ids = idsProfissionais(h);
  if (!ids.includes(usuarioId) || ids.length === 0) return 0;
  const partes = partesSplit(h.splitTipo);
  const recebido = valorRecebidoHonorario(h);
  return (recebido * (partes.profissional || 0)) / ids.length;
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
function totaisAssociado(honorariosDoProfissional, userId) {
  let totalContrato = 0, totalRecebidoCliente = 0, minhaParteRepassada = 0, minhaParteAguardando = 0;
  honorariosDoProfissional.forEach((h) => {
    const minhaParte = parteDoProfissional(h, userId);
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
