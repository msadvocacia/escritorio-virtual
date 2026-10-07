const { calcularInssProgressivo, obterAliquotaRpps } = require('./parametrosCalculo');
const { calcularCorrecaoComTransicaoSelic } = require('./correcaoMonetaria');
const { montarMemoriaCorrecao } = require('./memoriaCalculo');

/*
  Módulo "Aposentadoria" (servidor com previdência própria — RPPS) — duas
  modalidades que podem ser calculadas juntas, SEMPRE discriminadas:

  1) ABONO DE PERMANÊNCIA devido e não pago: o servidor já reunia os requisitos
     da aposentadoria, optou por continuar em atividade e o abono (equivalente à
     contribuição previdenciária que ele paga) não foi implantado desde a data
     em que era devido. Para cada mês entre a "data devida do abono" e o fim do
     período: devido = contribuição previdenciária do mês (rubrica "Fundo de
     Previdência" da ficha financeira); pago = rubrica "Abono de Permanência" da
     ficha; diferença = devido − pago (nunca negativa). A ficha financeira já
     mostra quando o abono passou a ser implantado — não é preciso informar essa data.

  2) APOSENTADORIA devida e não implantada: provento mensal que o servidor
     deveria ter recebido desde a "data devida da aposentadoria" até a data final
     do cálculo. O provento é montado a partir da ficha: salário-base do mês +
     as rubricas escolhidas como integrantes do provento (anuênio, gratificações
     permanentes etc. — o usuário escolhe, porque a lei local diz o que integra).
     Opcionalmente abate a remuneração que o servidor recebeu em atividade no mesmo
     mês (se ele continuou trabalhando, o mesmo mês não pode ser pago duas vezes).

  Correção monetária e juros: mesma engrenagem do módulo de Retroativos PCCR
  (IPCA-E + poupança até 08/12/2021; Selic de 09/12/2021 a 29/08/2024; IPCA-E +
  Taxa Legal a partir de 30/08/2024), mês a mês, até o último mês fechado
  antes da data de atualização.
*/

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function competenciaAnterior(competencia, meses) {
  const [ano, mes] = competencia.split('-').map(Number);
  const d = new Date(ano, mes - 1 - meses, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function ultimoDiaMesAnterior(dataISO) {
  const [ano, mes] = dataISO.split('-').map(Number);
  const d = new Date(ano, mes - 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function proximaCompetencia(c) {
  const [a, m] = c.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
}
function diasDoMes(competencia) {
  const [a, m] = competencia.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}

const REGEX_BASE = /SAL[AÁ]RIO\s*BASE|HORAS\s*AFASTADO|DIAS\s*TRABALHADOS/i; // já representadas por "basePago" do mês
const REGEX_ABONO = /ABONO.*PERMAN/i;
const REGEX_FUNDO_PREV = /FUNDO.*PREVID[EÊ]NCIA/i;
const REGEX_13 = /13/;
const REGEX_SINDICATO = /SINDSMUJE|SINDICATO/i;
const REGEX_NAO_REMUNERACAO = /ABONO.*PERMAN|AJUSTE|RETROATIV|DIFEREN[CÇ]A/i;

function rubricasDoMes(m) { return Array.isArray(m.rubricas) ? m.rubricas : []; }
function somaRubricas(lista, filtro) { return lista.filter(filtro).reduce((a, r) => a + (r.valor || 0), 0); }

async function calcularAposentadoria({
  modalidade, dataProtocolo, aplicarPrescricao, meses,
  dataDevidaAposentadoria, dataDevidaAbono, dataFimPeriodo, dataAtualizacao,
  composicaoBeneficio, incluir13Aposentadoria, incluir13Abono, abaterRemuneracao, projetarMeses,
  regraProvento, tcAnos, tcMeses, tcDias, tempoExigidoAnos, valorProventoInformado, proventoInformadoAcompanhaFicha,
  irrfAtivo, irrfPercentual, contribuicaoPatronalPercentual, regimePrevidenciario,
}) {
  if (!['aposentadoria', 'abono', 'ambos'].includes(modalidade)) throw new Error('Modalidade inválida.');
  if (!Array.isArray(meses) || !meses.length) throw new Error('Importe a ficha financeira (ou adicione ao menos um mês).');
  const calcAposentadoria = modalidade === 'aposentadoria' || modalidade === 'ambos';
  const calcAbono = modalidade === 'abono' || modalidade === 'ambos';
  if (calcAposentadoria && !dataDevidaAposentadoria) throw new Error('Informe a data em que a aposentadoria seria devida.');
  if (calcAbono && !dataDevidaAbono) throw new Error('Informe a data em que o abono de permanência era devido.');
  const comPrescricao = aplicarPrescricao !== false;
  if (comPrescricao && !dataProtocolo) throw new Error('Informe a data de protocolo (ou desative a prescrição quinquenal).');
  const regime = regimePrevidenciario === 'rgps' ? 'rgps' : 'rpps'; // servidor com aposentadoria própria: RPPS é o padrão
  const hoje = new Date().toISOString().slice(0, 10);
  const fimISO = dataFimPeriodo || hoje;
  const dataCorrecaoAte = ultimoDiaMesAnterior(dataAtualizacao || hoje);
  const projetar = projetarMeses !== false;
  // Regra de cálculo do provento: integral (integralidade + paridade), proporcional ao tempo de contribuição,
  // ou valor informado (quando o benefício é apurado por média ou outra regra, fora da ficha).
  const regra = ['integral', 'proporcional', 'informado'].includes(regraProvento) ? regraProvento : 'integral';
  let fracaoProporcional = 1;
  if (calcAposentadoria && regra === 'proporcional') {
    const diasTc = (Number(tcAnos) || 0) * 365 + (Number(tcMeses) || 0) * 30 + (Number(tcDias) || 0);
    const diasExigidos = (Number(tempoExigidoAnos) || 0) * 365;
    if (!(diasTc > 0) || !(diasExigidos > 0)) throw new Error('Na regra proporcional, informe o tempo de contribuição e o tempo exigido.');
    fracaoProporcional = Math.min(diasTc / diasExigidos, 1);
  }
  if (calcAposentadoria && regra === 'informado' && !(Number(valorProventoInformado) > 0)) throw new Error('Informe o valor do provento mensal devido.');
  const nomesComposicao = new Set((composicaoBeneficio || []).map((n) => String(n).toUpperCase().trim()));

  const ficha = [...meses].sort((a, b) => a.competencia.localeCompare(b.competencia));
  const porCompetencia = new Map(ficha.map((m) => [m.competencia, m]));
  const primeiraFicha = ficha[0].competencia;
  const ultimaFicha = ficha[ficha.length - 1].competencia;

  const inicioAposentadoria = calcAposentadoria ? dataDevidaAposentadoria : null;
  const inicioAbono = calcAbono ? dataDevidaAbono : null;
  const inicios = [inicioAposentadoria, inicioAbono].filter(Boolean).map((d) => d.slice(0, 7));
  const compInicial = inicios.sort()[0];
  const compFinal = fimISO.slice(0, 7);
  if (compInicial > compFinal) throw new Error('A data devida precisa ser anterior ao fim do período.');
  const competenciaLimite = comPrescricao ? competenciaAnterior(dataProtocolo.slice(0, 7), 60) : null;

  const linhas = [];
  const lancamentosAuditoria = []; // trilha da correção, consolidada em memoriaCorrecao
  const mesesSemFicha = [];
  const mesesProjetados = [];
  for (let comp = compInicial; comp <= compFinal; comp = proximaCompetencia(comp)) {
    let fonte = porCompetencia.get(comp);
    let projetado = false;
    if (!fonte) {
      if (comp > ultimaFicha && projetar) { fonte = porCompetencia.get(ultimaFicha); projetado = true; mesesProjetados.push(comp); }
      else { mesesSemFicha.push(comp); continue; }
    }
    const cortadoPorPrescricao = comPrescricao && comp < competenciaLimite;
    const rubr = rubricasDoMes(fonte);
    const [anoComp, mesComp] = comp.split('-').map(Number);
    const ehDezembro = mesComp === 12;
    const ultimoDia = diasDoMes(comp);

    // fração do mês (mês comercial: dias reais ÷ 30, no máximo 1) — só nas pontas, quando a data cai no meio do mês
    const fracaoPontas = (inicioISO) => {
      let f = 1;
      if (inicioISO && inicioISO.slice(0, 7) === comp) {
        const dia = parseInt(inicioISO.slice(8, 10), 10);
        if (dia > 1) f = Math.min((ultimoDia - dia + 1) / 30, 1);
      }
      if (comp === compFinal) {
        const diaFim = parseInt(fimISO.slice(8, 10), 10);
        if (diaFim < ultimoDia) f = Math.min(f * (Math.min(diaFim / 30, 1)), 1);
      }
      return f;
    };

    // ---- Abono de permanência ----
    let abono = null;
    const abonoNaJanela = calcAbono && comp >= inicioAbono.slice(0, 7);
    const fundo = rubr.find((r) => REGEX_FUNDO_PREV.test(r.nome) && !REGEX_13.test(r.nome));
    const abonoPago = somaRubricas(rubr, (r) => REGEX_ABONO.test(r.nome));
    if (abonoNaJanela) {
      const devido = fundo ? fundo.valor : 0;
      const f = fracaoPontas(inicioAbono);
      const diferenca = cortadoPorPrescricao ? 0 : round2(Math.max(devido * f - abonoPago * (f), 0));
      const reflexo13 = (!cortadoPorPrescricao && incluir13Abono !== false && ehDezembro) ? diferenca : 0;
      abono = { devido: round2(devido), pago: round2(abonoPago), fracao: f, diferenca, reflexo13, total: round2(diferenca + reflexo13) };
    }

    // ---- Aposentadoria devida ----
    let aposentadoria = null;
    const aposNaJanela = calcAposentadoria && comp >= inicioAposentadoria.slice(0, 7);
    if (aposNaJanela) {
      const base = fonte.basePago || 0;
      const integrantes = rubr.filter((r) => r.tipo === 'provento' && !REGEX_BASE.test(r.nome) && nomesComposicao.has(String(r.nome).toUpperCase().trim()));
      const remuneracaoCargo = base + integrantes.reduce((a, r) => a + r.valor, 0);
      let provento;
      if (regra === 'integral') provento = remuneracaoCargo; // integralidade + paridade: acompanha a remuneração dos ativos mês a mês
      else if (regra === 'proporcional') provento = remuneracaoCargo * fracaoProporcional;
      else {
        // valor informado; se "acompanha a ficha", varia na mesma proporção do salário-base lido (reajustes) a partir do mês inicial devido
        const mesBase = porCompetencia.get(inicioAposentadoria.slice(0, 7)) || ficha[0];
        provento = Number(valorProventoInformado) * (proventoInformadoAcompanhaFicha && mesBase.basePago ? base / mesBase.basePago : 1);
      }
      const remuneracaoAtividade = base + somaRubricas(rubr, (r) => r.tipo === 'provento' && !REGEX_BASE.test(r.nome) && !REGEX_NAO_REMUNERACAO.test(r.nome));
      const abatimento = abaterRemuneracao ? remuneracaoAtividade : 0;
      const f = fracaoPontas(inicioAposentadoria);
      const devidoMes = cortadoPorPrescricao ? 0 : round2(Math.max(provento - abatimento, 0) * f);
      const reflexo13 = (!cortadoPorPrescricao && incluir13Aposentadoria !== false && ehDezembro) ? devidoMes : 0;
      const fundoPct = fundo ? fundo.percentual : null;
      const sind = rubr.find((r) => REGEX_SINDICATO.test(r.nome));
      aposentadoria = {
        base: round2(base), integrantes: integrantes.map((r) => ({ nome: r.nome, valor: r.valor })),
        remuneracaoCargo: round2(remuneracaoCargo), provento: round2(provento), abatimento: round2(abatimento), fracao: f,
        devidoMes, reflexo13, total: round2(devidoMes + reflexo13),
        previdenciaPercentualFicha: fundoPct, sindicatoPercentual: sind ? sind.percentual : null,
      };
    }

    // ---- Correção monetária (cada parte separada, a partir do último dia da competência) ----
    const dataInicioCorrecao = `${comp}-${String(ultimoDia).padStart(2, '0')}`;
    const corrigir = async (valor, parte) => {
      if (!(valor > 0)) return valor || 0;
      const r = await calcularCorrecaoComTransicaoSelic(valor, dataInicioCorrecao, dataCorrecaoAte);
      lancamentosAuditoria.push({ competencia: comp, parte, valorNominal: valor, valorCorrigido: round2(r.valorFinal), fases: r.fases });
      return r.valorFinal;
    };
    if (abono) abono.corrigido = round2(await corrigir(abono.total, 'Abono de permanência'));
    if (aposentadoria) aposentadoria.corrigido = round2(await corrigir(aposentadoria.total, 'Aposentadoria devida'));

    linhas.push({ competencia: comp, cortadoPorPrescricao, projetado, abono, aposentadoria });
  }

  // ---- Descontos e resumo por parte ----
  const params = { regime, irrfAtivo: !!irrfAtivo, irrfPercentual: irrfPercentual || 0, patronal: contribuicaoPatronalPercentual };
  let anosSemTabelaExata = new Set();
  let avisoRppsSemAliquota = false;

  // Aposentadoria: contribuição previdenciária (percentual da própria ficha no RPPS), sindicato, IRRF e patronal
  const subtotalAposentadoria = linhas.reduce((s, l) => s + (l.aposentadoria ? l.aposentadoria.total : 0), 0);
  let previdencia = 0, sindicato = 0;
  for (const l of linhas) {
    if (!l.aposentadoria || l.aposentadoria.total <= 0) continue;
    const a = l.aposentadoria;
    if (regime === 'rgps') {
      const r = await calcularInssProgressivo(a.total, l.competencia);
      previdencia += r.valor;
      if (!r.anoExato) anosSemTabelaExata.add(l.competencia.slice(0, 4));
    } else {
      let pct = a.previdenciaPercentualFicha;
      if (pct == null) {
        const r = await obterAliquotaRpps(parseInt(l.competencia.slice(0, 4), 10));
        if (r.valor == null) { avisoRppsSemAliquota = true; pct = 0; } else { pct = r.valor; if (!r.anoExato) anosSemTabelaExata.add(l.competencia.slice(0, 4)); }
      }
      a.previdenciaPercentual = pct;
      previdencia += a.total * (pct / 100);
    }
    if (a.sindicatoPercentual) sindicato += a.total * (a.sindicatoPercentual / 100);
  }
  previdencia = round2(previdencia); sindicato = round2(sindicato);
  const irrfAposentadoria = params.irrfAtivo ? round2(Math.max(subtotalAposentadoria - previdencia, 0) * (params.irrfPercentual / 100)) : 0;
  const patronalPct = params.patronal != null ? params.patronal : 0;
  const patronal = round2(subtotalAposentadoria * (patronalPct / 100));
  const somaAposentadoriaCorrigida = linhas.reduce((s, l) => s + (l.aposentadoria ? l.aposentadoria.corrigido : 0), 0);
  const resumoAposentadoria = calcAposentadoria ? {
    somaA: round2(subtotalAposentadoria), somaACorrigida: round2(somaAposentadoriaCorrigida), diferencaCorrecao: round2(somaAposentadoriaCorrigida - subtotalAposentadoria),
    previdencia, sindicato, irrf: irrfAposentadoria, somaB: round2(previdencia + sindicato + irrfAposentadoria),
    valorLiquido: round2(subtotalAposentadoria - previdencia - sindicato - irrfAposentadoria),
    valorLiquidoCorrigido: round2(somaAposentadoriaCorrigida - previdencia - sindicato - irrfAposentadoria),
    percentualPatronal: patronalPct, contribuicaoPatronal: patronal,
  } : null;
  if (resumoAposentadoria) {
    resumoAposentadoria.totalC = round2(resumoAposentadoria.valorLiquido + resumoAposentadoria.somaB + patronal);
    resumoAposentadoria.totalCCorrigido = round2(resumoAposentadoria.valorLiquidoCorrigido + resumoAposentadoria.somaB + patronal);
  }

  // Abono: sem contribuição previdenciária e sem sindicato; só IRRF (verba tributável); sem patronal
  const subtotalAbono = linhas.reduce((s, l) => s + (l.abono ? l.abono.total : 0), 0);
  const somaAbonoCorrigido = linhas.reduce((s, l) => s + (l.abono ? l.abono.corrigido : 0), 0);
  const irrfAbono = params.irrfAtivo ? round2(subtotalAbono * (params.irrfPercentual / 100)) : 0;
  const resumoAbono = calcAbono ? {
    somaA: round2(subtotalAbono), somaACorrigida: round2(somaAbonoCorrigido), diferencaCorrecao: round2(somaAbonoCorrigido - subtotalAbono),
    previdencia: 0, sindicato: 0, irrf: irrfAbono, somaB: irrfAbono,
    valorLiquido: round2(subtotalAbono - irrfAbono), valorLiquidoCorrigido: round2(somaAbonoCorrigido - irrfAbono),
    percentualPatronal: 0, contribuicaoPatronal: 0,
    totalC: round2(subtotalAbono), totalCCorrigido: round2(somaAbonoCorrigido),
  } : null;

  const soma = (campo) => round2((resumoAposentadoria ? resumoAposentadoria[campo] : 0) + (resumoAbono ? resumoAbono[campo] : 0));
  const resumoTotal = {
    somaA: soma('somaA'), somaACorrigida: soma('somaACorrigida'), diferencaCorrecao: soma('diferencaCorrecao'),
    previdencia: soma('previdencia'), sindicato: soma('sindicato'), irrf: soma('irrf'), somaB: soma('somaB'),
    valorLiquido: soma('valorLiquido'), valorLiquidoCorrigido: soma('valorLiquidoCorrigido'),
    contribuicaoPatronal: soma('contribuicaoPatronal'), totalC: soma('totalC'), totalCCorrigido: soma('totalCCorrigido'),
  };

  // ---- Avisos ----
  const avisos = [];
  if (mesesSemFicha.length) avisos.push(`A ficha financeira não cobre ${mesesSemFicha.length > 6 ? mesesSemFicha.slice(0, 3).join(', ') + ' … ' + mesesSemFicha[mesesSemFicha.length - 1] : mesesSemFicha.join(', ')} — esses meses NÃO entraram no cálculo. Importe uma ficha que cubra todo o período devido.`);
  if (mesesProjetados.length) avisos.push(`Os meses ${mesesProjetados[0]} a ${mesesProjetados[mesesProjetados.length - 1]} são posteriores ao fim da ficha e foram PROJETADOS repetindo os valores do último mês da ficha (${ultimaFicha}). Substitua por uma ficha atualizada quando houver.`);
  if (anosSemTabelaExata.size) avisos.push(`Não há ${regime === 'rgps' ? 'tabela do INSS' : 'alíquota de RPPS'} cadastrada para o(s) ano(s) ${[...anosSemTabelaExata].sort().join(', ')} — usei a mais próxima como aproximação.`);
  if (regime === 'rpps' && avisoRppsSemAliquota) avisos.push('Alguns meses não tinham o percentual de previdência na ficha nem alíquota cadastrada em "Parâmetros de Cálculo" — o desconto previdenciário desses meses ficou zerado.');
  if (calcAbono) avisos.push('Abono de permanência: devido = contribuição previdenciária do mês constante na ficha ("Fundo de Previdência"), menos o abono já pago na ficha; no mês de dezembro, soma-se igual valor se a opção do 13º estiver marcada. Sobre o abono não foram descontadas previdência nem contribuição sindical (apenas IRRF, se aplicado). Confira a lei municipal sobre o limite do abono e sua incidência no 13º.');
  if (calcAposentadoria) {
    avisos.push(regra === 'integral'
      ? 'Aposentadoria com integralidade e paridade: o provento de cada mês é a remuneração do cargo efetivo daquele mês (salário-base da ficha + as rubricas marcadas como integrantes), acompanhando os reajustes dos servidores ativos. Confira na legislação aplicável quais vantagens se incorporam ao provento — o sistema não decide isso.'
      : regra === 'proporcional'
        ? `Aposentadoria com proventos proporcionais: o provento de cada mês é a remuneração do cargo efetivo (salário-base da ficha + rubricas marcadas) multiplicada por ${(fracaoProporcional * 100).toFixed(4)}% (tempo de contribuição informado ÷ tempo exigido). Confira na legislação aplicável a fórmula da proporcionalidade e se há paridade nesta regra.`
        : `Aposentadoria com valor de provento informado (R$ ${Number(valorProventoInformado).toFixed(2)}${proventoInformadoAcompanhaFicha ? ', variando como o salário-base da ficha' : ', fixo em todos os meses'}): use esta opção quando o benefício for apurado por média ou outra regra que a ficha não permite reproduzir.`);
    avisos.push('Contribuição previdenciária: calculada com o percentual lançado na própria ficha; servidor inativo costuma contribuir só sobre o que excede o teto do RGPS (confira a lei do ente), e a contribuição patronal só foi aplicada se informada.');
    const mesesComSalarioNaFicha = linhas.filter((l) => l.aposentadoria && !l.projetado && !l.cortadoPorPrescricao).length;
    if (!abaterRemuneracao && mesesComSalarioNaFicha) avisos.push(`Atenção: a ficha mostra remuneração em atividade nesses meses e a opção "abater a remuneração recebida na ativa" está DESMARCADA — se o servidor continuou trabalhando e recebendo, o valor da aposentadoria devida está sendo apurado sem descontar o que ele já recebeu.`);
  }
  if (modalidade === 'ambos') {
    const sobrepostos = linhas.filter((l) => l.abono && l.aposentadoria && l.abono.total > 0 && l.aposentadoria.total > 0).length;
    if (sobrepostos) avisos.push(`Abono de permanência e aposentadoria são, em regra, excludentes no mesmo mês (o abono só existe para quem permanece em atividade). ${sobrepostos} mês(es) têm valor devido nas duas modalidades — os resultados estão discriminados, mas confira se não há duplicidade na pretensão.`);
  }
  avisos.push('Correção monetária automática, mês a mês, em três regimes sucessivos: IPCA-E + juros de mora pela poupança até 08/12/2021; Selic acumulada de 09/12/2021 a 29/08/2024 (art. 3º da EC 113/2021); IPCA-E + Taxa Legal (Selic − IPCA-15, nunca negativa) a partir de 30/08/2024 (arts. 389 e 406 do Código Civil, Lei 14.905/2024) — buscados ao vivo no Banco Central e parando no último mês fechado antes da data de atualização. Os descontos são calculados sobre os valores NOMINAIS. A fase de juros (Taxa Legal) é aproximada (ver aviso do módulo de Retroativos PCCR).');

  return {
    modalidade, regraProvento: regra, fracaoProporcional: regra === 'proporcional' ? fracaoProporcional : null, regimePrevidenciario: regime, aplicouPrescricao: comPrescricao, competenciaLimitePrescricao: competenciaLimite,
    dataCorrecaoAte, dataFimPeriodo: fimISO, linhas, avisos,
    memoriaCorrecao: montarMemoriaCorrecao(lancamentosAuditoria, { dataCorrecaoAte, titulo: 'Memória de cálculo — Aposentadoria / Abono de permanência' }),
    resumo: { aposentadoria: resumoAposentadoria, abono: resumoAbono, total: resumoTotal },
  };
}

module.exports = { calcularAposentadoria };
