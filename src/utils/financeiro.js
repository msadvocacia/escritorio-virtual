function partesSplit(splitTipo) {
  switch (splitTipo) {
    case 'associado_70_30': return { associado: 0.7, escritorio: 0.3 };
    case 'associado_60_40': return { associado: 0.6, escritorio: 0.4 };
    case 'associado_50_50': return { associado: 0.5, escritorio: 0.5 };
    case 'associado_50_socio_30_escritorio_20': return { associado: 0.5, socio: 0.3, escritorio: 0.2 };
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
  if (!h.associadoId) return 1;
  const partes = partesSplit(h.splitTipo);
  return 1 - (partes.associado || 0);
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

/** Totais do relatório para o associado (só os processos dele). */
function totaisAssociado(honorariosDoAssociado) {
  let totalContrato = 0, totalRecebidoCliente = 0, minhaParteRepassada = 0, minhaParteAguardando = 0;
  honorariosDoAssociado.forEach((h) => {
    const partes = partesSplit(h.splitTipo);
    const recebido = valorRecebidoHonorario(h);
    const minhaParte = recebido * (partes.associado || 0);
    totalContrato += h.valorTotal;
    totalRecebidoCliente += recebido;
    if (h.repasseStatus === 'confirmado') minhaParteRepassada += minhaParte;
    else minhaParteAguardando += minhaParte;
  });
  return { totalContrato, totalRecebidoCliente, minhaParteRepassada, minhaParteAguardando };
}

module.exports = { partesSplit, valorRecebidoHonorario, fracaoEscritorio, resumoEscritorio, totaisAssociado };
