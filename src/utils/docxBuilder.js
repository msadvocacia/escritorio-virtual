// Helpers para montar parágrafos/rodadas de texto (runs) em OOXML "na mão",
// dando controle total sobre negrito, caixa alta, alinhamento e recuo — coisa
// que o docxtemplater (usado no resto do sistema) não permite fazer de forma
// dinâmica quando o número de pessoas no parágrafo muda a cada processo.
//
// A fonte (Times New Roman 12) e o espaçamento (1,5 linha) já vêm do estilo
// "Normal" do próprio arquivo-base (ver templates/letterhead_base.docx), então
// aqui só precisamos nos preocupar com negrito, alinhamento e recuos.

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const CM_PARA_TWIPS = 566.929; // 1 cm em "twentieths of a point" (unidade do OOXML)
function cmParaTwips(cm) {
  return Math.round(cm * CM_PARA_TWIPS);
}

/** Uma "rodada" de texto (w:r), com negrito e tamanho de fonte opcionais. */
function run(texto, { bold = false, sizeHalfPt = null } = {}) {
  const partes = [];
  if (bold) partes.push('<w:b/>');
  if (sizeHalfPt) partes.push(`<w:sz w:val="${sizeHalfPt}"/><w:szCs w:val="${sizeHalfPt}"/>`);
  const rPr = partes.length ? `<w:rPr>${partes.join('')}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(texto)}</w:t></w:r>`;
}

/** Um parágrafo, a partir de uma lista de runs (strings XML já prontas), de um texto simples, ou de um único run já pronto (string começando com "<w:r>"). */
function paragraph(runsOuTexto, { center = false, justify = true, indentCm = null, bold = false } = {}) {
  let runsXml;
  if (Array.isArray(runsOuTexto)) {
    runsXml = runsOuTexto.join('');
  } else if (typeof runsOuTexto === 'string' && runsOuTexto.startsWith('<w:r')) {
    runsXml = runsOuTexto; // já é XML de um run pronto (ex: veio de run() diretamente)
  } else {
    runsXml = run(runsOuTexto, { bold });
  }
  const jc = center ? '<w:jc w:val="center"/>' : (justify ? '<w:jc w:val="both"/>' : '');
  const ind = indentCm != null ? `<w:ind w:left="${cmParaTwips(indentCm)}"/>` : '';
  const pPr = (jc || ind) ? `<w:pPr>${jc}${ind}</w:pPr>` : '';
  return `<w:p>${pPr}${runsXml}</w:p>`;
}

function blank() { return '<w:p/>'; }

/**
 * Monta os "runs" de um parágrafo com vários nomes (outorgantes, outorgados,
 * contratantes ou contratados), cada nome em negrito seguido da qualificação
 * normal. Se TODOS tiverem o mesmo endereço, o endereço não se repete pessoa a
 * pessoa — aparece uma única vez ao final do parágrafo.
 * pessoas: [{ nome (já em caixa alta), qualificacaoSemEndereco, endereco }]
 */
function montarBlocoPessoas(pessoas, sizeHalfPt) {
  if (!pessoas || !pessoas.length) return [run('—', { sizeHalfPt })];
  const enderecos = pessoas.map((p) => (p.endereco || '').trim()).filter(Boolean);
  const enderecoComum = pessoas.length > 1 && enderecos.length === pessoas.length && enderecos.every((e) => e === enderecos[0]);

  const runs = [];
  pessoas.forEach((p, i) => {
    if (i > 0) {
      const isLast = i === pessoas.length - 1;
      runs.push(run(isLast && pessoas.length > 1 ? ' e ' : ', ', { sizeHalfPt }));
    }
    runs.push(run(p.nome, { bold: true, sizeHalfPt }));
    let qualif = ', ' + (p.qualificacaoSemEndereco || '');
    if (!enderecoComum && p.endereco) {
      qualif += ', residente e domiciliado(a) em ' + p.endereco;
    }
    runs.push(run(qualif, { sizeHalfPt }));
  });
  if (enderecoComum) {
    runs.push(run(`, residentes e domiciliados em ${enderecos[0]}`, { sizeHalfPt }));
  }
  runs.push(run('.', { sizeHalfPt }));
  return runs;
}

/**
 * Divide um texto em runs, deixando em negrito qualquer ocorrência exata dos
 * termos informados (ex: "OUTORGANTE", "O ADVOGADO"). Sempre casa a ocorrência
 * mais à esquerda entre todos os termos, o que naturalmente prioriza frases
 * mais longas quando elas começam no mesmo ponto (ex: "O ADVOGADO" antes de
 * "ADVOGADO" sozinho).
 */
function comDestaques(texto, termos) {
  let restante = texto;
  const runs = [];
  while (restante.length) {
    let melhorIdx = -1;
    let melhorTermo = null;
    for (const t of termos) {
      const idx = restante.indexOf(t);
      if (idx !== -1 && (melhorIdx === -1 || idx < melhorIdx)) { melhorIdx = idx; melhorTermo = t; }
    }
    if (melhorIdx === -1) { runs.push(run(restante)); break; }
    if (melhorIdx > 0) runs.push(run(restante.slice(0, melhorIdx)));
    runs.push(run(melhorTermo, { bold: true }));
    restante = restante.slice(melhorIdx + melhorTermo.length);
  }
  return runs;
}

/**
 * Uma tabela OOXML de verdade (bordas finas, cabeçalho em negrito), a partir de
 * um array de cabeçalhos (strings) e um array de linhas, onde cada linha é um
 * array de células — cada célula pode ser uma string simples ou um array de
 * runs já prontos (para poder deixar só parte do conteúdo em negrito).
 */
function tabela(cabecalhos, linhas, { largurasCm = null } = {}) {
  const borda = '<w:tcBorders>' + ['top', 'left', 'bottom', 'right'].map((lado) =>
    `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>`).join('') + '</w:tcBorders>';

  function celula(conteudo, { bold = false, larguraCm = null } = {}) {
    let runsXml;
    if (Array.isArray(conteudo)) {
      runsXml = conteudo.join('');
    } else if (typeof conteudo === 'string' && conteudo.startsWith('<w:r')) {
      runsXml = conteudo; // já é XML de um run pronto
    } else {
      runsXml = run(conteudo, { bold });
    }
    const tcW = larguraCm != null ? `<w:tcW w:w="${cmParaTwips(larguraCm)}" w:type="dxa"/>` : '<w:tcW w:w="0" w:type="auto"/>';
    return `<w:tc><w:tcPr>${tcW}${borda}<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr>${runsXml}</w:p></w:tc>`;
  }

  const grid = largurasCm ? `<w:tblGrid>${largurasCm.map((c) => `<w:gridCol w:w="${cmParaTwips(c)}"/>`).join('')}</w:tblGrid>` : '';
  const linhaCabecalho = `<w:tr>${cabecalhos.map((h, i) => celula(h, { bold: true, larguraCm: largurasCm ? largurasCm[i] : null })).join('')}</w:tr>`;
  const linhasXml = linhas.map((linha) =>
    `<w:tr>${linha.map((c, i) => celula(c, { larguraCm: largurasCm ? largurasCm[i] : null })).join('')}</w:tr>`
  ).join('');

  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((lado) =>
    `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>`).join('')}</w:tblBorders></w:tblPr>${grid}${linhaCabecalho}${linhasXml}</w:tbl>`;
}

module.exports = { xmlEscape, cmParaTwips, run, paragraph, blank, montarBlocoPessoas, comDestaques, tabela };
