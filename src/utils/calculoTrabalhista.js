/*
  Cálculo de verbas rescisórias — dispensa sem justa causa (o caso mais comum).
  Fórmulas padronizadas pela CLT. Sempre confira o resultado antes de usar em
  petição — este cálculo não substitui a conferência de um profissional,
  especialmente em casos com adicionais, médias variáveis ou convenção
  coletiva com regras próprias.
*/

function diasEntre(iso1, iso2) {
  return Math.round((new Date(iso2 + 'T00:00:00') - new Date(iso1 + 'T00:00:00')) / 86400000);
}

function mesesCompletos(dataAdmissao, dataFim) {
  const a = new Date(dataAdmissao + 'T00:00:00');
  const f = new Date(dataFim + 'T00:00:00');
  let meses = (f.getFullYear() - a.getFullYear()) * 12 + (f.getMonth() - a.getMonth());
  if (f.getDate() < a.getDate()) meses -= 1;
  return Math.max(meses, 0);
}

/** Meses trabalhados dentro do ano civil da rescisão, para 13º proporcional (fração ≥15 dias conta como mês inteiro). */
function mesesNoAnoCorrente(dataAdmissao, dataDemissao) {
  const anoDemissao = parseInt(dataDemissao.slice(0, 4), 10);
  const inicioAno = dataAdmissao > `${anoDemissao}-01-01` ? dataAdmissao : `${anoDemissao}-01-01`;
  let meses = 0;
  const d = new Date(inicioAno + 'T00:00:00');
  const fim = new Date(dataDemissao + 'T00:00:00');
  while (d <= fim) {
    const inicioMes = new Date(d.getFullYear(), d.getMonth(), 1);
    const fimMes = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const fimConsiderado = fimMes < fim ? fimMes : fim;
    const diasNoMes = Math.round((fimConsiderado - Math.max(d, inicioMes)) / 86400000) + 1;
    if (diasNoMes >= 15) meses++;
    d.setMonth(d.getMonth() + 1);
    d.setDate(1);
  }
  return Math.min(meses, 12);
}

function calcularRescisao({ salario, dataAdmissao, dataDemissao, avisoPrevioIndenizado, saldoFgtsInformado }) {
  const dataUltimoDiaMes = dataDemissao.slice(0, 7) + '-01';
  const diasNoMesDemissao = diasEntre(dataUltimoDiaMes, dataDemissao) + 1;

  // 1) Saldo de salário
  const saldoSalario = (salario / 30) * diasNoMesDemissao;

  // 2) Aviso prévio (indenizado): 30 dias + 3 dias por ano completo de trabalho, máximo 90 dias (Lei 12.506/2011)
  const anosCompletos = Math.floor(mesesCompletos(dataAdmissao, dataDemissao) / 12);
  const diasAvisoPrevio = Math.min(30 + anosCompletos * 3, 90);
  const avisoPrevioValor = avisoPrevioIndenizado ? (salario / 30) * diasAvisoPrevio : 0;
  // Projeção do aviso prévio indenizado conta como tempo de serviço para 13º e férias:
  const dataFimProjetada = avisoPrevioIndenizado
    ? new Date(new Date(dataDemissao + 'T00:00:00').getTime() + diasAvisoPrevio * 86400000).toISOString().slice(0, 10)
    : dataDemissao;

  // 3) 13º salário proporcional (considerando a projeção do aviso prévio indenizado)
  const mesesPara13 = mesesNoAnoCorrente(dataAdmissao, dataFimProjetada);
  const decimoTerceiro = (salario / 12) * mesesPara13;

  // 4) Férias proporcionais + 1/3: meses dentro do período aquisitivo EM CURSO
  // (ou seja, desde o último aniversário de admissão completo), não o tempo total de casa.
  const totalMesesCasa = mesesCompletos(dataAdmissao, dataFimProjetada);
  const mesesFerias = totalMesesCasa % 12;
  const baseFerias = (salario / 12) * mesesFerias;
  const feriasProporcionais = baseFerias + baseFerias / 3;

  // 5) FGTS (8% ao mês) + multa de 40% sobre o saldo (se não informado, estima pelo tempo de serviço)
  const mesesTotais = mesesCompletos(dataAdmissao, dataFimProjetada);
  const saldoFgts = saldoFgtsInformado != null && saldoFgtsInformado > 0 ? saldoFgtsInformado : salario * 0.08 * mesesTotais;
  const multaFgts = saldoFgts * 0.40;

  const total = saldoSalario + avisoPrevioValor + decimoTerceiro + feriasProporcionais + saldoFgts + multaFgts;

  return {
    diasNoMesDemissao,
    saldoSalario,
    diasAvisoPrevio,
    avisoPrevioValor,
    avisoPrevioIndenizado,
    mesesPara13,
    decimoTerceiro,
    mesesParaFerias: mesesFerias,
    feriasProporcionais,
    saldoFgts,
    multaFgts,
    total,
  };
}

module.exports = { calcularRescisao };
