const { calcularInssProgressivo, obterParametrosCalculo, obterAliquotaRpps, obterAliquotaPatronalRpps } = require('./parametrosCalculo');

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

async function calcularRetroativoPccr({ modalidade, dataProtocolo, meses, irrfAtivo, irrfPercentual, contribuicaoPatronalPercentual, regimePrevidenciario }) {
  if (!['nivel', 'gratificacao'].includes(modalidade)) throw new Error('Modalidade inválida.');
  if (!dataProtocolo) throw new Error('Informe a data de protocolo do processo administrativo.');
  if (!Array.isArray(meses) || !meses.length) throw new Error('Informe ao menos um mês.');
  const regime = regimePrevidenciario === 'rpps' ? 'rpps' : 'rgps';

  const params = await obterParametrosCalculo();

  // Prescrição quinquenal (Decreto 20.910/32): corta tudo antes de (protocolo - 5 anos).
  const competenciaLimite = competenciaAnterior(dataProtocolo.slice(0, 7), 60);

  const linhas = [];
  for (const m of meses) {
    const cortadoPorPrescricao = m.competencia < competenciaLimite;
    let valorBase = 0;
    let detalheVerbas = [];

    if (!cortadoPorPrescricao) {
      if (modalidade === 'nivel') {
        const diferencaBase = (m.baseDevido || 0) - (m.basePago || 0);
        detalheVerbas = (m.verbasPercentuais || []).map((v) => ({
          nome: v.nome,
          percentual: v.percentual,
          valor: (v.percentual / 100) * diferencaBase,
        }));
        valorBase = diferencaBase + detalheVerbas.reduce((s, v) => s + v.valor, 0);
      } else {
        const valorGratificacao = ((m.percentualGratificacao || 0) / 100) * (m.basePago || 0);
        valorBase = valorGratificacao;
      }
    }

    const reflexo13 = (!cortadoPorPrescricao && m.incluir13) ? valorBase : 0;
    const reflexoFerias = (!cortadoPorPrescricao && m.incluirFerias) ? valorBase / 3 : 0;
    const totalMes = valorBase + reflexo13 + reflexoFerias;

    linhas.push({
      competencia: m.competencia,
      cortadoPorPrescricao,
      basePago: m.basePago || 0,
      baseDevido: modalidade === 'nivel' ? (m.baseDevido || 0) : null,
      diferencaBase: modalidade === 'nivel' ? (cortadoPorPrescricao ? 0 : ((m.baseDevido || 0) - (m.basePago || 0))) : null,
      valorGratificacao: modalidade === 'gratificacao' ? valorBase : null,
      detalheVerbas,
      reflexo13,
      reflexoFerias,
      valorBase,
      totalMes,
    });
  }

  // A — Proventos
  const subtotalSalarial = linhas.reduce((s, l) => s + l.valorBase + l.reflexo13, 0);
  const subtotalIndenizatorio = linhas.reduce((s, l) => s + l.reflexoFerias, 0);
  const somaA = subtotalSalarial + subtotalIndenizatorio;

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

  const avisos = [];
  if (anosSemTabelaExata.size) {
    avisos.push(`Não há ${regime === 'rgps' ? 'tabela do INSS' : 'alíquota de RPPS'} cadastrada para o(s) ano(s) ${[...anosSemTabelaExata].sort().join(', ')} — usei a mais próxima cadastrada como aproximação. Cadastre o valor exato desses anos em "Parâmetros de Cálculo" para um resultado preciso.`);
  }
  if (regime === 'rpps' && avisoRppsSemAliquota) {
    avisos.push('Nenhuma alíquota de RPPS cadastrada para os anos deste cálculo — o desconto previdenciário ficou zerado. Cadastre a alíquota da previdência própria deste município em "Parâmetros de Cálculo" (confira a lei municipal aplicável).');
  }

  return {
    modalidade,
    regimePrevidenciario: regime,
    competenciaLimitePrescricao: competenciaLimite,
    linhas,
    avisos,
    resumo: {
      subtotalSalarial, subtotalIndenizatorio, somaA,
      somaInss, irrfAtivo: !!irrfAtivo, somaIrrf, somaB,
      valorLiquido,
      percentualPatronal: percentualPatronalEfetivo, contribuicaoPatronal, totalC,
    },
  };
}

module.exports = { calcularRetroativoPccr };
