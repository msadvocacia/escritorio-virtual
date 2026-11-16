// Editor de relatório com formatação (negrito, itálico, sublinhado, alinhamento,
// listas e tamanho da fonte). O navegador devolve HTML; aqui ele é lido por um
// leitor próprio que só reconhece um punhado de tags e DESCARTA todo o resto —
// o que sobra é re-escrito em HTML limpo (guardado no cadastro) e convertido
// em parágrafos do Word. Nada do que vem do navegador é guardado como está.

const D = require('./docxBuilder');

const ENTIDADES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
function decodificar(t) {
  return t.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+);/g, (m) => {
    if (ENTIDADES[m] !== undefined) return ENTIDADES[m];
    const n = m.match(/^&#(\d+);$/);
    return n ? String.fromCodePoint(Math.min(parseInt(n[1], 10), 0x10FFFF)) : m;
  });
}
function escaparHtml(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// <font size="1..7"> do navegador -> meio-pontos do Word
const TAMANHO_FONT = { 1: 16, 2: 20, 3: 24, 4: 28, 5: 36, 6: 48, 7: 72 };
const BLOCOS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'li']);

function alinhamentoDe(atributos) {
  const m = /text-align\s*:\s*(left|center|right|justify)/i.exec(atributos) || /align\s*=\s*["']?(left|center|right|justify)/i.exec(atributos);
  return m ? m[1].toLowerCase() : null;
}

/** HTML -> lista de blocos (parágrafos) com runs formatados. */
function lerBlocos(html) {
  const blocos = [];
  let atual = null;
  const fmt = { b: 0, i: 0, u: 0, tamanhos: [] };
  const pilhaBloco = [];
  const pilhaLista = [];
  const alinhamentoCorrente = () => {
    for (let k = pilhaBloco.length - 1; k >= 0; k--) if (pilhaBloco[k].align) return pilhaBloco[k].align;
    return null;
  };
  const fechar = () => {
    if (!atual) return;
    while (atual.runs.length && atual.runs[atual.runs.length - 1].br) atual.runs.pop();
    if (atual.runs.length || atual.vazio || atual.lista) blocos.push(atual);
    atual = null;
  };
  const garantir = () => {
    if (!atual) atual = { align: alinhamentoCorrente(), runs: [], lista: null, titulo: 0, vazio: false };
    return atual;
  };

  const fonte = String(html || '').slice(0, 2000000).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|</g;
  let m;
  while ((m = re.exec(fonte))) {
    if (m[3] !== undefined) {
      const texto = decodificar(m[3]).replace(/[\r\n\t]+/g, ' ');
      if (!texto.trim() && !atual) continue;
      if (!texto) continue;
      const b = garantir();
      b.runs.push({ t: texto, b: fmt.b > 0 || b.titulo > 0, i: fmt.i > 0, u: fmt.u > 0, tam: fmt.tamanhos.length ? fmt.tamanhos[fmt.tamanhos.length - 1] : 0 });
      continue;
    }
    if (!m[1]) continue;
    const tag = m[1].toLowerCase();
    const fecha = m[0][1] === '/';
    const attrs = m[2] || '';
    if (BLOCOS.has(tag)) {
      if (!fecha) {
        fechar();
        pilhaBloco.push({ tag, align: alinhamentoDe(attrs) });
        if (tag === 'li') {
          const lista = pilhaLista[pilhaLista.length - 1] || { tipo: 'ul', n: 0 };
          lista.n += 1;
          atual = { align: alinhamentoCorrente(), runs: [], lista: { tipo: lista.tipo, n: lista.n }, titulo: 0, vazio: false };
        } else if (tag[0] === 'h') {
          atual = { align: alinhamentoCorrente(), runs: [], lista: null, titulo: Number(tag[1]), vazio: false };
        }
      } else {
        fechar();
        for (let k = pilhaBloco.length - 1; k >= 0; k--) { if (pilhaBloco[k].tag === tag) { pilhaBloco.length = k; break; } }
      }
    } else if (tag === 'ul' || tag === 'ol') {
      fechar();
      if (!fecha) pilhaLista.push({ tipo: tag, n: 0 }); else pilhaLista.pop();
    } else if (tag === 'br') {
      if (!atual) { atual = { align: alinhamentoCorrente(), runs: [], lista: null, titulo: 0, vazio: true }; }
      else if (atual.runs.length) atual.runs.push({ br: true });
      else atual.vazio = true;
    } else if (tag === 'b' || tag === 'strong') {
      fmt.b = Math.max(0, fmt.b + (fecha ? -1 : 1));
    } else if (tag === 'i' || tag === 'em') {
      fmt.i = Math.max(0, fmt.i + (fecha ? -1 : 1));
    } else if (tag === 'u') {
      fmt.u = Math.max(0, fmt.u + (fecha ? -1 : 1));
    } else if (tag === 'font') {
      if (fecha) fmt.tamanhos.pop();
      else { const s = /size\s*=\s*["']?([1-7])/i.exec(attrs); fmt.tamanhos.push(s ? Number(s[1]) : (fmt.tamanhos[fmt.tamanhos.length - 1] || 0)); }
    }
  }
  fechar();
  return blocos;
}

/** Blocos -> HTML limpo (só as tags conhecidas). */
function serializar(blocos) {
  const saida = [];
  let aberta = null;
  const fecharLista = () => { if (aberta) { saida.push(`</${aberta}>`); aberta = null; } };
  blocos.forEach((b) => {
    const interior = b.runs.length
      ? b.runs.map((r) => {
        if (r.br) return '<br>';
        let h = escaparHtml(r.t);
        if (r.tam && r.tam !== 3) h = `<font size="${r.tam}">${h}</font>`;
        if (r.u) h = `<u>${h}</u>`;
        if (r.i) h = `<i>${h}</i>`;
        if (r.b && !b.titulo) h = `<b>${h}</b>`;
        return h;
      }).join('')
      : '<br>';
    const estilo = b.align ? ` style="text-align:${b.align}"` : '';
    if (b.lista) {
      if (aberta !== b.lista.tipo) { fecharLista(); saida.push(`<${b.lista.tipo}>`); aberta = b.lista.tipo; }
      saida.push(`<li${estilo}>${interior}</li>`);
      return;
    }
    fecharLista();
    if (b.titulo) saida.push(`<h${b.titulo}${estilo}>${interior}</h${b.titulo}>`);
    else saida.push(`<p${estilo}>${interior}</p>`);
  });
  fecharLista();
  return saida.join('');
}

function sanitizarHtml(html) { return serializar(lerBlocos(html)); }

function runXml(r) {
  if (r.br) return '<w:r><w:br/></w:r>';
  const partes = [];
  if (r.b) partes.push('<w:b/>');
  if (r.i) partes.push('<w:i/>');
  const meio = r.tamPt || (r.tam ? TAMANHO_FONT[r.tam] : 0);
  if (meio) partes.push(`<w:sz w:val="${meio}"/><w:szCs w:val="${meio}"/>`);
  if (r.u) partes.push('<w:u w:val="single"/>');
  const rPr = partes.length ? `<w:rPr>${partes.join('')}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${D.xmlEscape(r.t)}</w:t></w:r>`;
}

/** HTML do editor -> parágrafos OOXML (para o corpo do timbrado). */
function htmlParaCorpo(html) {
  return lerBlocos(html).map((b) => {
    if (!b.runs.length) return '<w:p/>';
    const runs = b.runs.map((r) => (b.titulo && !r.br ? { ...r, b: true, tamPt: r.tam ? 0 : ({ 1: 32, 2: 28, 3: 26 }[b.titulo] || 26) } : r));
    const prefixo = b.lista ? [{ t: b.lista.tipo === 'ol' ? `${b.lista.n}. ` : '•  ', b: false, i: false, u: false, tam: 0 }] : [];
    const jc = { left: 'left', center: 'center', right: 'right', justify: 'both' }[b.align] || 'both';
    const ind = b.lista ? '<w:ind w:left="567" w:hanging="283"/>' : '';
    return `<w:p><w:pPr>${ind}<w:jc w:val="${jc}"/></w:pPr>${[...prefixo, ...runs].map(runXml).join('')}</w:p>`;
  }).join('');
}

/** Texto simples (uma linha = um parágrafo) -> HTML do editor. Linhas em CAIXA ALTA viram título centralizado em negrito. */
function textoParaHtml(texto) {
  return String(texto || '').split('\n').map((linha) => {
    if (!linha.trim()) return '<p><br></p>';
    const ehTitulo = linha === linha.toUpperCase() && /[A-ZÀ-Ú]/.test(linha);
    return ehTitulo
      ? `<p style="text-align:center"><b>${escaparHtml(linha)}</b></p>`
      : `<p style="text-align:justify">${escaparHtml(linha)}</p>`;
  }).join('');
}

module.exports = { sanitizarHtml, htmlParaCorpo, textoParaHtml, lerBlocos };
