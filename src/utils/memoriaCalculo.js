const crypto = require('crypto');

/*
  Memória de cálculo auditável da correção monetária e dos juros.

  Recebe os lançamentos corrigidos (cada um com as "fases" devolvidas pelo
  motor de correção) e consolida, para conferência por perito ou pela parte
  contrária:
    - a base legal de cada regime e o período em que foi aplicado;
    - as fontes oficiais (série do SGS/Banco Central, URL, data/hora da
      consulta e se veio ao vivo, do cache ou de cache vencido);
    - a TABELA DE ÍNDICES mês a mês realmente usada (cada série, cada mês);
    - cada lançamento: valor nominal, fator de correção, juros e valor final
      por fase;
    - uma impressão digital (SHA-256) dos índices e dos resultados, que
      permite provar depois que os números não foram alterados.
  Nada aqui recalcula valores — só descreve o que o motor já calculou.
*/

const REGIMES = [
  { chave: 'ipca-e+poupanca', fase: '1ª fase', periodo: 'até 08/12/2021',
    regra: 'Correção monetária pelo IPCA-E (IBGE) e juros de mora simples, mês a mês, pelo rendimento da caderneta de poupança.',
    baseLegal: 'Art. 1º-F da Lei 9.494/97 (redação da Lei 11.960/09), com a correção monetária pelo IPCA-E conforme decidido pelo STF no Tema 810 (RE 870.947) e adotado no Manual de Cálculos da Justiça Federal.' },
  { chave: 'selic', fase: '2ª fase', periodo: '09/12/2021 a 29/08/2024',
    regra: 'Selic acumulada mensalmente, aplicada isoladamente (a Selic já embute correção e juros).',
    baseLegal: 'Art. 3º da Emenda Constitucional nº 113/2021 (redação original), cuja aplicação a qualquer discussão ou condenação da Fazenda Pública foi fixada pelo STF no Tema 1.419 de repercussão geral (ARE 1.557.312/SP).' },
  { chave: 'ipca-e+taxalegal', fase: '3ª fase', periodo: 'a partir de 30/08/2024',
    regra: 'Correção monetária pelo IPCA-E e juros de mora simples pela Taxa Legal (Selic − IPCA-15, publicada pelo Banco Central).',
    baseLegal: 'Arts. 389 e 406 do Código Civil, com a redação da Lei nº 14.905/2024, aplicados por determinação da sentença/decisão do caso; índice de correção conforme definido nessa decisão.' },
];

function nomeRegime(texto) {
  if (/Selic acumulada/.test(texto)) return 'selic';
  if (/poupan/i.test(texto)) return 'ipca-e+poupanca';
  return 'ipca-e+taxalegal';
}

function f_ultimaFase(l) { const f = l.fases || []; return f.length ? f[f.length - 1].valorFinal : null; }
function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function r6(n) { return Math.round((n + Number.EPSILON) * 1e6) / 1e6; }

/**
 * @param {Array} lancamentos [{ competencia, parte, valorNominal, fases }]
 * @param {object} opts { dataCorrecaoAte, titulo }
 */
function montarMemoriaCorrecao(lancamentos, { dataCorrecaoAte, titulo } = {}) {
  const fontes = new Map();            // indice -> { ...meta, origens:Set, primeira, ultima }
  const indices = new Map();           // indice -> Map(mes -> valor)
  const regimesUsados = new Set();
  const avisos = [];
  const avisadosSemIndice = new Set();
  let selicAteAtualizacao = false;

  let totalNominalCru = 0;
  let totalCorrigidoCru = 0;
  const itens = (lancamentos || []).map((l) => {
    const fases = (l.fases || []).map((f) => {
      const chave = nomeRegime(f.regime);
      regimesUsados.add(chave);
      if (chave === 'selic' && dataCorrecaoAte && f.ate === dataCorrecaoAte) selicAteAtualizacao = true;
      (f.series || []).forEach((s) => {
        // Último mês da correção sem índice publicado ainda? O motor só multiplica os
        // meses que existem na série; sem este aviso a correção ficaria menor sem ninguém notar.
        if (dataCorrecaoAte && f.ate === dataCorrecaoAte && !avisadosSemIndice.has(s.indice)) {
          const esperado = dataCorrecaoAte.slice(0, 7);
          const ultimo = (s.meses || []).reduce((mx, m) => (m.mes > mx ? m.mes : mx), '');
          if (ultimo && ultimo < esperado) {
            avisadosSemIndice.add(s.indice);
            avisos.push(`O índice ${s.indice} ainda não foi publicado pelo Banco Central para ${esperado.split('-').reverse().join('/')} (último disponível: ${ultimo.split('-').reverse().join('/')}). A correção foi aplicada somente até o último mês publicado; refaça o cálculo após a divulgação para incluir o mês faltante.`);
          }
        }
        if (!indices.has(s.indice)) indices.set(s.indice, new Map());
        (s.meses || []).forEach((m) => indices.get(s.indice).set(m.mes, m.indice));
        const meta = s.fonte;
        if (meta) {
          let fo = fontes.get(s.indice);
          if (!fo) { fo = { indice: s.indice, serieBCB: meta.serieBCB, descricao: meta.descricao, fonteUrl: meta.fonteUrl, origens: new Set(), primeira: meta.consultadoEm, ultima: meta.consultadoEm }; fontes.set(s.indice, fo); }
          fo.origens.add(meta.origem);
          if (meta.consultadoEm < fo.primeira) fo.primeira = meta.consultadoEm;
          if (meta.consultadoEm > fo.ultima) fo.ultima = meta.consultadoEm;
        }
      });
      return {
        regime: chave, descricao: f.regime, de: f.de, ate: f.ate,
        valorInicial: r2(f.valorInicial), fatorCorrecao: r6(f.fatorCorrecao != null ? f.fatorCorrecao : 1),
        jurosPercentual: r6(f.jurosPercentual || 0),
        valorCorrigidoSemJuros: r2(f.valorCorrigido != null ? f.valorCorrigido : f.valorFinal),
        juros: r2(f.juros || 0), valorFinal: r2(f.valorFinal),
      };
    });
    const nominal = r2(l.valorNominal);
    // valor "cru" (o mesmo que o módulo usou para somar o resumo) — evita
    // diferença de centavos entre esta memória e o resumo do cálculo
    const corrigidoCru = l.valorCorrigido != null ? l.valorCorrigido : (f_ultimaFase(l) != null ? f_ultimaFase(l) : l.valorNominal);
    const corrigido = r2(corrigidoCru);
    totalNominalCru += l.valorNominal;
    totalCorrigidoCru += corrigidoCru;
    return {
      competencia: l.competencia, parte: l.parte || '', correcaoDesde: fases.length ? fases[0].de : null,
      valorNominal: nominal, valorCorrigido: corrigido, diferenca: r2(corrigido - nominal),
      fatorGlobal: nominal ? r6(corrigido / nominal) : 1, fases,
    };
  });

  const tabelaIndices = {};
  [...indices.keys()].sort().forEach((nome) => {
    tabelaIndices[nome] = [...indices.get(nome).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([mes, valor]) => ({ mes, valor }));
  });

  const fontesLista = [...fontes.values()].map((f) => ({
    indice: f.indice, serieBCB: f.serieBCB, descricao: f.descricao, fonteUrl: f.fonteUrl,
    origens: [...f.origens], consultadoDe: f.primeira, consultadoAte: f.ultima,
  }));
  if (fontesLista.some((f) => f.origens.includes('cache-vencido'))) {
    avisos.push('Atenção: o Banco Central estava indisponível na consulta e, para ao menos uma série, foram usados valores oficiais salvos em consulta anterior (cache vencido). Os valores são os mesmos publicados pelo BCB, mas recomenda-se refazer o cálculo quando o serviço voltar, para registrar a consulta atual.');
  }

  const totais = { nominal: r2(totalNominalCru), corrigido: r2(totalCorrigidoCru) };
  totais.diferenca = r2(totais.corrigido - totais.nominal);

  const conteudoHash = JSON.stringify({ dataCorrecaoAte, tabelaIndices, itens: itens.map((i) => [i.competencia, i.parte, i.valorNominal, i.valorCorrigido]) });
  const impressaoDigital = crypto.createHash('sha256').update(conteudoHash).digest('hex');

  return {
    titulo: titulo || 'Memória de cálculo da correção monetária e juros',
    geradoEm: new Date().toISOString(),
    dataCorrecaoAte: dataCorrecaoAte || null,
    metodologia: REGIMES.filter((r) => regimesUsados.has(r.chave)).map((r) => {
      if (r.chave === 'selic' && selicAteAtualizacao && dataCorrecaoAte) {
        return { ...r, periodo: `09/12/2021 a ${dataCorrecaoAte.split('-').reverse().join('/')} (data da atualização)` };
      }
      return r;
    }),
    convencoes: [
      'Cada valor devido é corrigido individualmente, a partir do último dia do mês de competência (data em que o salário/benefício se torna exigível), até o último dia do último mês fechado anterior à data de atualização.',
      'Pró-rata nominal nas pontas de cada fase: o primeiro mês entra com a fração dos dias restantes (a partir da data inicial, inclusive) e o último com a fração dos dias decorridos; os meses intermediários entram cheios. Fator de correção = produto de (1 + índice do mês × peso do mês).',
      'Juros de mora simples: soma, mês a mês, de (valor corrigido na data inicial da fase × índice do mês × peso). Na fase da Selic não há juros separados, pois o índice já os contém.',
      'Cada fase começa com o valor final da anterior. Os descontos legais (previdência, contribuição sindical e IRRF) incidem sobre os valores NOMINAIS e são abatidos do total corrigido; não são atualizados.',
      'Os totais são a soma dos valores sem arredondamento; os valores de cada linha são exibidos arredondados em centavos, o que pode gerar diferença de centavos entre a soma visual das linhas e o total.',
      'Índices obtidos automaticamente da API pública do Sistema Gerenciador de Séries Temporais (SGS) do Banco Central do Brasil, sem digitação manual.',
    ],
    fontes: fontesLista,
    tabelaIndices,
    lancamentos: itens,
    totais,
    avisos,
    impressaoDigital,
  };
}

module.exports = { montarMemoriaCorrecao, REGIMES };
