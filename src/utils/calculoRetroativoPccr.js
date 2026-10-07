const { calcularInssProgressivo, obterParametrosCalculo, obterAliquotaRpps, obterAliquotaPatronalRpps } = require('./parametrosCalculo');
const { calcularCorrecaoComTransicaoSelic } = require('./correcaoMonetaria');
const { montarMemoriaCorrecao } = require('./memoriaCalculo');

/*
  Módulo de retroativos de Plano de Cargos e Salários (PCCR) — duas modalidades:
    1) Mudança de nível: altera o salário-base, com reflexos em verbas percentuais.
    2) Implantação de gratificação: a gratificação em si nunca existiu (não há
       "base devido" diferente — o base já estava correto).

  IMPORTANTE — como este módulo foi construído: você me passou uma especificação
  escrita bem detalhada, e eu segui ela à risca. Também recebi um PDF de exemplo
  (ficha financeira + um cálculo pronto, modelo "RM Cálculos"), mas a ferramenta de
  visualização de imagem não carregou nesta sessão — só consegui ler o documento via
  OCR (que tem ruído nos dígitos exatos, por ser um documento escaneado). Isso foi
  suficiente para CONFIRMAR a estrutura A/B/C que você descreveu (bate exatamente
  com o que vi), mas NÃO foi suficiente para validar os valores finais, dígito a
  dígito, contra aquele caso real. Recomendo testar com um caso conhecido antes de
  confiar cegamente no resultado.

  Não implementei (ainda) a extração automática de dados a partir do PDF da ficha
  financeira nem da tabela de níveis do PCS — isso exigiria um leitor de documento
  robusto o bastante para lidar com formatos variados por prefeitura, o que é um
  projeto à parte. Por enquanto, a entrada é manual (mês a mês).
*/

function mesesEntre(iso1, iso2) {
  const [a1, m1] = iso1.split('-').map(Number);
  const [a2, m2] = iso2.split('-').map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}

function competenciaAnterior(competencia, meses) {
  const [ano, mes] = competencia.split('-').map(Number);
  const d = new Date(ano, mes - 1 - meses, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Último dia do mês ANTERIOR a uma data — os índices (IPCA-E, Taxa Legal) do
// mês corrente ainda não estão publicados quando o cálculo é gerado, então a
// correção para no último mês já fechado, não no dia exato da emissão.
function ultimoDiaMesAnterior(dataISO) {
  const [ano, mes] = dataISO.split('-').map(Number);
  const d = new Date(ano, mes - 1, 0); // dia 0 do mês informado = último dia do mês anterior
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Anos completos de serviço numa competência, a partir da data de admissão
// (o dia exato do mês não muda o resultado — o anuênio vira no mês-aniversário).
function anosCompletosServico(dataAdmissaoISO, competenciaISO) {
  const [anoAdm, mesAdm] = dataAdmissaoISO.split('-').map(Number);
  const [anoComp, mesComp] = competenciaISO.split('-').map(Number);
  let anos = anoComp - anoAdm;
  if (mesComp < mesAdm) anos -= 1;
  return Math.max(anos, 0);
}

function aplicarReajustesEmCadeia(valorInicial, competenciaInicial, reajustes, competencia) {
  let valor = valorInicial;
  for (const r of [...(reajustes || [])].sort((a, b) => a.competencia.localeCompare(b.competencia))) {
    if (r.competencia <= competenciaInicial) continue; // já embutido no valor inicial
    if (r.competencia > competencia) break; // ainda não vigorava nesta competência
    valor *= 1 + (r.percentual || 0) / 100;
  }
  return valor;
}

/**
 * Calcula basePago, baseDevido e o percentual de anuênio para UMA competência,
 * a partir de uma configuração automática — em vez de digitar um valor fixo
 * (ou um novo valor a cada reajuste) para cada mês:
 *   - um valor inicial de referência para cada um (base pago e base devido);
 *   - duas listas de reajustes INDEPENDENTES — reajustesBasePago e
 *     reajustesBaseDevido — já que, na prática, o salário realmente pago
 *     continua evoluindo normalmente (reajustes gerais, mudanças de classe)
 *     enquanto o valor "devido" de referência pode ficar fixo, ou vice-versa;
 *     cada reajuste tem a competência em que passou a vigorar e o percentual,
 *     aplicados EM CADEIA a partir do valor vigente até ali;
 *   - o anuênio, calculado automaticamente como X% por ano completo de
 *     serviço a partir da data de admissão, respeitando uma carência mínima
 *     de anos e um teto máximo (ambos configuráveis — CONFIRME contra a lei
 *     municipal do caso, já que isso varia).
 */
function calcularBaseEAnuenioAutomatico(config, competencia) {
  const basePago = aplicarReajustesEmCadeia(config.basePagoInicial || 0, config.competenciaInicial, config.reajustesBasePago, competencia);
  const baseDevido = aplicarReajustesEmCadeia(config.baseDevidoInicial || 0, config.competenciaInicial, config.reajustesBaseDevido, competencia);
  let anuenioPercentual = 0;
  if (config.anuenioAtivo && config.dataAdmissao) {
    const anos = anosCompletosServico(config.dataAdmissao, competencia);
    const carencia = config.anuenioCarenciaAnos ?? 5;
    if (anos > carencia) {
      anuenioPercentual = anos * (config.anuenioPercentualPorAno ?? 1);
      const teto = config.anuenioTeto ?? 35;
      anuenioPercentual = Math.min(anuenioPercentual, teto);
    }
  }
  return { basePago, baseDevido, anuenioPercentual };
}

async function calcularRetroativoPccr({ modalidade, dataProtocolo, aplicarPrescricao, meses, irrfAtivo, irrfPercentual, contribuicaoPatronalPercentual, regimePrevidenciario, dataAtualizacao, configSalarial }) {
  if (!['nivel', 'gratificacao'].includes(modalidade)) throw new Error('Modalidade inválida.');
  // Prescrição quinquenal é opcional (padrão: aplicada). Sem prescrição, a data de protocolo não é necessária.
  const comPrescricao = aplicarPrescricao !== false;
  if (comPrescricao && !dataProtocolo) throw new Error('Informe a data de protocolo do processo administrativo (ou desative a prescrição quinquenal).');
  if (!Array.isArray(meses) || !meses.length) throw new Error('Informe ao menos um mês.');
  const regime = regimePrevidenciario === 'rpps' ? 'rpps' : 'rgps';
  // A correção para no último mês JÁ FECHADO antes da data informada — o mês
  // corrente ainda não tem IPCA-E/Taxa Legal publicados quando o cálculo é
  // gerado (confirmado contra um cálculo real já homologado).
  const dataCorrecaoAte = ultimoDiaMesAnterior(dataAtualizacao || new Date().toISOString().slice(0, 10));

  const params = await obterParametrosCalculo();

  // Prescrição quinquenal (Decreto 20.910/32): corta tudo antes de (protocolo - 5 anos).
  const competenciaLimite = comPrescricao ? competenciaAnterior(dataProtocolo.slice(0, 7), 60) : null;

  const linhas = [];
  for (const m of meses) {
    const cortadoPorPrescricao = comPrescricao && m.competencia < competenciaLimite;
    let valorBase = 0;
    let detalheVerbas = [];

    // Se houver configSalarial, ela fornece basePago/baseDevido e o percentual
    // de anuênio automaticamente para esta competência — mas um valor
    // explicitamente informado no mês (m.basePago, m.baseDevido, ou uma verba
    // "ANUENIO" já na lista) sempre tem prioridade sobre o automático.
    let basePagoEfetivo = m.basePago;
    let baseDevidoEfetivo = m.baseDevido;
    let verbasEfetivas = m.verbasPercentuais || [];
    if (configSalarial) {
      const auto = calcularBaseEAnuenioAutomatico(configSalarial, m.competencia);
      if (basePagoEfetivo == null) basePagoEfetivo = auto.basePago;
      if (baseDevidoEfetivo == null) baseDevidoEfetivo = auto.baseDevido;
      const jaTemAnuenio = verbasEfetivas.some((v) => /anu[eê]nio/i.test(v.nome));
      if (!jaTemAnuenio && configSalarial.anuenioAtivo && auto.anuenioPercentual > 0) {
        verbasEfetivas = [...verbasEfetivas, { nome: 'ANUÊNIO', percentual: auto.anuenioPercentual, automatico: true }];
      }
    }
    // Mês parcial (primeiro ou último mês do período retroativo, quando o
    // início ou o fim cai no meio do mês): prorrateia os PRÓPRIOS valores de
    // base (não só o total), em "mês comercial" — o denominador é sempre 30
    // dias, mas os dias usados são os dias reais do mês (não limitados a 30).
    // Confirmado contra um cálculo real: do dia 17 ao dia 31 (mês de 31 dias
    // reais), prorrateou como (31-17+1)/30 = 15/30 = 50%; e do dia 1 ao 27
    // (mês de 30 dias), (27-1+1)/30 = 90%, nos dois níveis.
    if (m.diaInicio || m.diaFim) {
      const diaInicio = m.diaInicio || 1;
      const [anoComp, mesComp] = m.competencia.split('-').map(Number);
      const diaFim = m.diaFim || new Date(anoComp, mesComp, 0).getDate();
      const fracao = Math.max(diaFim - diaInicio + 1, 0) / 30;
      if (basePagoEfetivo != null) basePagoEfetivo *= fracao;
      if (baseDevidoEfetivo != null) baseDevidoEfetivo *= fracao;
    }

    if (!cortadoPorPrescricao) {
      if (modalidade === 'nivel') {
        const diferencaBase = (baseDevidoEfetivo || 0) - (basePagoEfetivo || 0);
        detalheVerbas = verbasEfetivas.map((v) => ({
          nome: v.nome,
          percentual: v.percentual,
          valor: (v.percentual / 100) * diferencaBase,
        }));
        valorBase = diferencaBase + detalheVerbas.reduce((s, v) => s + v.valor, 0);
      } else {
        const valorGratificacao = ((m.percentualGratificacao || 0) / 100) * (basePagoEfetivo || 0);
        valorBase = valorGratificacao;
      }
    }

    const reflexo13 = (!cortadoPorPrescricao && m.incluir13) ? valorBase : 0;
    const reflexoFerias = (!cortadoPorPrescricao && m.incluirFerias) ? valorBase / 3 : 0;
    const totalMes = valorBase + reflexo13 + reflexoFerias;

    // Correção monetária automática, mês a mês, com três regimes sucessivos
    // e pró-rata nominal nas pontas — buscados ao vivo no Banco Central. A
    // contagem começa do ÚLTIMO dia do mês de competência (quando o salário
    // efetivamente vence), não do dia 1, já que o pró-rata agora conta dias
    // dentro do próprio mês.
    let totalMesCorrigido = totalMes;
    let fasesCorrecao = [];
    if (totalMes > 0 && !cortadoPorPrescricao) {
      const [anoComp, mesComp] = m.competencia.split('-').map(Number);
      const ultimoDiaCompetencia = new Date(anoComp, mesComp, 0).getDate();
      const dataInicioCorrecao = `${m.competencia}-${String(ultimoDiaCompetencia).padStart(2, '0')}`;
      const rCorrecao = await calcularCorrecaoComTransicaoSelic(totalMes, dataInicioCorrecao, dataCorrecaoAte);
      totalMesCorrigido = rCorrecao.valorFinal;
      fasesCorrecao = rCorrecao.fases;
    }

    linhas.push({
      competencia: m.competencia,
      cortadoPorPrescricao,
      basePago: basePagoEfetivo || 0,
      baseDevido: modalidade === 'nivel' ? (baseDevidoEfetivo || 0) : null,
      diferencaBase: modalidade === 'nivel' ? (cortadoPorPrescricao ? 0 : ((baseDevidoEfetivo || 0) - (basePagoEfetivo || 0))) : null,
      valorGratificacao: modalidade === 'gratificacao' ? valorBase : null,
      detalheVerbas,
      reflexo13,
      reflexoFerias,
      valorBase,
      totalMes,
      totalMesCorrigido,
      fasesCorrecao,
    });
  }

  // A — Proventos
  const subtotalSalarial = linhas.reduce((s, l) => s + l.valorBase + l.reflexo13, 0);
  const subtotalIndenizatorio = linhas.reduce((s, l) => s + l.reflexoFerias, 0);
  const somaA = subtotalSalarial + subtotalIndenizatorio;
  const somaACorrigida = linhas.reduce((s, l) => s + l.totalMesCorrigido, 0);
  const diferencaCorrecao = somaACorrigida - somaA;

  // B — Descontos previdenciários. Dois regimes possíveis:
  //   RGPS (INSS nacional): tabela progressiva por faixa, escolhida pelo ano da competência.
  //   RPPS (previdência própria, comum em servidor municipal/estadual): alíquota
  //     FIXA definida por lei do próprio ente, que também pode mudar por ano
  //     (a cada lei de reajuste) — por isso também é uma tabela editável por ano,
  //     só que de alíquota única, não progressiva.
  let somaInss = 0;
  let anosSemTabelaExata = new Set();
  let avisoRppsSemAliquota = false;
  for (const l of linhas) {
    const baseSalarialMes = l.valorBase + l.reflexo13;
    if (baseSalarialMes <= 0) continue;
    const ano = parseInt(l.competencia.slice(0, 4), 10);
    if (regime === 'rgps') {
      const r = await calcularInssProgressivo(baseSalarialMes, l.competencia);
      somaInss += r.valor;
      if (!r.anoExato) anosSemTabelaExata.add(l.competencia.slice(0, 4));
    } else {
      const r = await obterAliquotaRpps(ano);
      if (r.valor == null) { avisoRppsSemAliquota = true; continue; }
      somaInss += baseSalarialMes * (r.valor / 100);
      if (!r.anoExato) anosSemTabelaExata.add(l.competencia.slice(0, 4));
    }
  }
  const baseIrrf = Math.max(subtotalSalarial - somaInss, 0);
  const somaIrrf = irrfAtivo ? baseIrrf * ((irrfPercentual || 0) / 100) : 0;
  const somaB = somaInss + somaIrrf;

  const valorLiquido = somaA - somaB;
  const valorLiquidoCorrigido = somaACorrigida - somaB;

  // C — Valores devidos pelo município (empregador). No RPPS, a alíquota
  // patronal também costuma ser fixada pela mesma lei municipal (não os 20%
  // "genéricos" do RGPS) — se cadastrada por ano, usa essa; senão, cai no
  // percentual informado manualmente (ou o padrão de 25%).
  let percentualPatronalEfetivo = contribuicaoPatronalPercentual != null ? contribuicaoPatronalPercentual : params.contribuicaoPatronalPadrao;
  if (regime === 'rpps' && contribuicaoPatronalPercentual == null) {
    // usa a média dos anos envolvidos, se cadastrada, para dar um número único de referência
    const anoMaisComum = linhas.filter((l) => !l.cortadoPorPrescricao).map((l) => parseInt(l.competencia.slice(0, 4), 10));
    if (anoMaisComum.length) {
      const r = await obterAliquotaPatronalRpps(anoMaisComum[anoMaisComum.length - 1]);
      percentualPatronalEfetivo = r.valor;
    }
  }
  const contribuicaoPatronal = subtotalSalarial * (percentualPatronalEfetivo / 100);
  const totalC = valorLiquido + somaInss + somaIrrf + contribuicaoPatronal;
  const totalCCorrigido = valorLiquidoCorrigido + somaInss + somaIrrf + contribuicaoPatronal;

  const avisos = [];
  if (anosSemTabelaExata.size) {
    avisos.push(`Não há ${regime === 'rgps' ? 'tabela do INSS' : 'alíquota de RPPS'} cadastrada para o(s) ano(s) ${[...anosSemTabelaExata].sort().join(', ')} — usei a mais próxima cadastrada como aproximação. Cadastre o valor exato desses anos em "Parâmetros de Cálculo" para um resultado preciso.`);
  }
  if (regime === 'rpps' && avisoRppsSemAliquota) {
    avisos.push('Nenhuma alíquota de RPPS cadastrada para os anos deste cálculo — o desconto previdenciário ficou zerado. Cadastre a alíquota da previdência própria deste município em "Parâmetros de Cálculo" (confira a lei municipal aplicável).');
  }
  if (configSalarial?.anuenioAtivo) {
    avisos.push(`Anuênio calculado automaticamente (${configSalarial.anuenioPercentualPorAno ?? 1}% por ano completo de serviço, carência de ${configSalarial.anuenioCarenciaAnos ?? 5} anos, teto de ${configSalarial.anuenioTeto ?? 35}%) a partir da data de admissão informada — CONFIRME esses três números contra a lei municipal do caso antes de usar em petição, já que variam por município.`);
  }
  avisos.push('Correção monetária automática, mês a mês, com pró-rata nominal nas pontas, em três regimes sucessivos: IPCA-E + juros de mora pela poupança até 08/12/2021; Selic acumulada de 09/12/2021 a 29/08/2024 (Art. 3º da EC nº 113/2021); IPCA-E + Taxa Legal (Selic − IPCA-15, nunca negativa) a partir de 30/08/2024 (arts. 389 e 406 do Código Civil, Lei nº 14.905/2024) — buscados ao vivo no Banco Central. A correção para no último mês já fechado antes da data de atualização (o mês corrente ainda não tem índice publicado). Os descontos de INSS/IRRF e a contribuição patronal continuam calculados sobre os valores NOMINAIS históricos.');
  avisos.push('A fase de correção monetária (IPCA-E) está confirmada exata contra um cálculo real já homologado. A fase de juros (Taxa Legal) foi testada contra o mesmo caso e ficou muito próxima, mas não bateu dígito a dígito — a diferença encontrada foi de cerca de 0,44% do valor total. Confira o resultado antes de protocolar, e me avise se conseguir a memória de cálculo detalhada do perito/calculista contrário para eu calibrar com precisão.');

  const memoriaCorrecao = montarMemoriaCorrecao(
      linhas.filter((l) => l.totalMes > 0 && !l.cortadoPorPrescricao).map((l) => ({
        competencia: l.competencia, parte: modalidade === 'nivel' ? 'Diferença de nível' : 'Gratificação', valorNominal: l.totalMes, valorCorrigido: l.totalMesCorrigido, fases: l.fasesCorrecao,
      })),
      { dataCorrecaoAte, titulo: 'Memória de cálculo — Retroativos PCCR' }
    );
  // Os índices mês a mês ficam só na memória consolidada (evita repetir em cada linha)
  linhas.forEach((l) => { l.fasesCorrecao = (l.fasesCorrecao || []).map(({ series, ...resto }) => resto); });

  return {
    modalidade,
    regimePrevidenciario: regime,
    competenciaLimitePrescricao: competenciaLimite,
    aplicouPrescricao: comPrescricao,
    dataCorrecaoAte,
    linhas,
    avisos,
    memoriaCorrecao,
    resumo: {
      subtotalSalarial, subtotalIndenizatorio, somaA, somaACorrigida, diferencaCorrecao,
      somaInss, irrfAtivo: !!irrfAtivo, somaIrrf, somaB,
      valorLiquido, valorLiquidoCorrigido,
      percentualPatronal: percentualPatronalEfetivo, contribuicaoPatronal, totalC, totalCCorrigido,
    },
  };
}

module.exports = { calcularRetroativoPccr };
