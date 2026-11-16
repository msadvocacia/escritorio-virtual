// Certificado de estágio em PDF (2 páginas, A4 paisagem), fiel ao modelo do
// escritório: página 1 = grade curricular e aproveitamento; página 2 = o
// certificado. Fundo, moldura e logo vêm de templates/certificado; textos
// fixos (títulos) em Gelasio (equivalente métrico do Georgia) e os campos
// preenchidos em Calibri (Carlito, equivalente métrico).

const path = require('path');
const PDFDocument = require('pdfkit');

const DIR = path.join(__dirname, '..', '..', 'templates', 'certificado');
const FONTES = {
  calibri: path.join(DIR, 'fontes', 'Carlito-Regular.ttf'),
  calibriB: path.join(DIR, 'fontes', 'Carlito-Bold.ttf'),
  georgia: path.join(DIR, 'fontes', 'Gelasio-Regular.woff'),
  georgiaB: path.join(DIR, 'fontes', 'Gelasio-Bold.woff'),
  georgiaI: path.join(DIR, 'fontes', 'Gelasio-Italic.woff'),
};

const W = 841.92;
const H = 595.32;
const MARROM = '#A87529';
const MARROM_CLARO = '#D3C4A5';
const FUNDO = '#FAF3EE';
const LINHA_PAR = '#F4EFE6';
const TOTAL_FUNDO = '#E8DFCE';

const DISCIPLINAS = [
  { id: 'processual', nome: 'Prática Processual e Elaboração de Peças' },
  { id: 'audiencias', nome: 'Acompanhamento de Audiências de Conciliação e Instrução' },
  { id: 'atendimento', nome: 'Atendimento ao Cliente, Triagem e Análise Documental' },
  { id: 'pesquisa', nome: 'Pesquisa Doutrinária, Jurisprudencial e Elaboração de Pareceres' },
  { id: 'peticionamento', nome: 'Peticionamento e Manuseio de Sistemas Processuais Eletrônicos (PJe/Projudi)' },
  { id: 'consumidor', nome: 'Prática em Direito do Consumidor e Contratos' },
  { id: 'familia', nome: 'Prática em Direito de Família e Sucessões' },
  { id: 'etica', nome: 'Ética Profissional Aplicada à Advocacia' },
  { id: 'diligencias', nome: 'Diligências Extrajudiciais, Cartorárias e Registrais' },
];

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function partesData(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return { d: parseInt(m[3], 10), mes: MESES[parseInt(m[2], 10) - 1], a: m[1], dd: m[3], mm: m[2] };
}
/** "5 de dezembro de 2026" */
function dataPorExtenso(iso) {
  if (iso === 'XXXX') return 'XX de XXXXXXXX de XXXX';
  const p = partesData(iso);
  return p ? `${p.d} de ${p.mes} de ${p.a}` : '____ de ____________ de ________';
}
/** "05/12/2026" */
function dataCurta(iso) {
  if (iso === 'XXXX') return 'XX/XX/XXXX';
  const p = partesData(iso);
  return p ? `${p.dd}/${p.mm}/${p.a}` : '_____/_____/________';
}
function horas(v) {
  const s = String(v == null ? '' : v).trim();
  return s || '____';
}

/**
 * dados: { nome, cpf, inicio, fim, cargaTotal, cargas: {processual: '20', ...}, emissao, advOab }
 * Campos vazios saem como linhas para preencher à mão.
 */
function gerarCertificadoPdf(dados) {
  const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: true, info: { Title: 'Certificado de Estágio', Author: 'MS Advocacia' } });
  Object.entries(FONTES).forEach(([nome, arq]) => doc.registerFont(nome, arq));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const pronto = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  // Posiciona pelo "topo" da caixa do texto, como nas medidas do modelo; centraliza em torno de cx quando pedido.
  const DESCENT = { calibri: 0.25, calibriB: 0.25, georgia: 0.217, georgiaB: 0.217, georgiaI: 0.217 };
  function texto(str, { fonte, tam, cor = '#000000', x = 0, topo = 0, cx = null, direita = null, largura = null }) {
    doc.font(fonte).fontSize(tam);
    const w = doc.widthOfString(str);
    const baseline = topo + tam * (1 - DESCENT[fonte]);
    const asc = doc._font.ascender / 1000 * tam;
    let px = x;
    if (cx != null) px = cx - w / 2;
    if (direita != null) px = direita - w;
    doc.fillColor(cor).text(str, px, baseline - asc, { lineBreak: false });
    return w;
  }
  /** Reduz a letra até o texto caber na largura (nomes compridos). */
  function tamanhoQueCabe(str, fonte, tam, max, min = 8) {
    let t = tam;
    doc.font(fonte);
    while (t > min) { doc.fontSize(t); if (doc.widthOfString(str) <= max) break; t -= 0.5; }
    return t;
  }
  const ret = (x0, y0, x1, y1, cor) => doc.rect(x0, y0, x1 - x0, y1 - y0).fill(cor);

  // ---------- PÁGINA 1 — grade curricular ----------
  ret(0, 0, W, H, FUNDO);
  doc.image(path.join(DIR, 'borda.png'), 35.25, 34.4, { width: 779.2, height: 532.6 });
  texto('GRADE CURRICULAR E APROVEITAMENTO DO ESTÁGIO SUPERVISIONADO', { fonte: 'georgiaB', tam: 12.5, cor: MARROM, topo: 82.9, direita: 671.2 });

  // caixa de identificação
  ret(124.5, 125.1, 727.7, 178.5, '#FFFFFF');
  ret(124.5, 125.1, 727.7, 126.0, MARROM);
  ret(124.5, 177.5, 727.7, 178.5, MARROM);
  ret(124.5, 125.1, 125.4, 178.5, MARROM);
  ret(726.7, 125.1, 727.7, 178.5, MARROM);
  ret(125.4, 151.5, 726.7, 151.9, MARROM_CLARO);
  ret(493.8, 126.0, 494.2, 177.5, MARROM_CLARO);
  const nomeEst = String(dados.nome || '').trim();
  texto('ESTAGIÁRIO(A): ', { fonte: 'calibriB', tam: 11, topo: 128.2, x: 130.3 });
  const tamNome = tamanhoQueCabe(nomeEst || 'x', 'calibri', 11, 280);
  if (nomeEst) texto(nomeEst, { fonte: 'calibri', tam: tamNome, topo: 128.2, x: 205.3 });
  else ret(205.3, 138.8, 481.6, 139.3, '#000000');
  texto('CPF: ', { fonte: 'calibriB', tam: 11, topo: 128.2, x: 499.4 });
  if (dados.cpf) texto(dados.cpf, { fonte: 'calibri', tam: 11, topo: 128.2, x: 521.7 });
  else ret(521.7, 138.8, 655.6, 139.3, '#000000');
  texto('PERÍODO: ', { fonte: 'calibriB', tam: 11, topo: 154.1, x: 130.3 });
  texto(`${dataCurta(dados.inicio)} a ${dataCurta(dados.fim)}`, { fonte: 'calibri', tam: 11, topo: 154.1, x: 178.1 });
  texto('CARGA HORÁRIA TOTAL: ', { fonte: 'calibriB', tam: 11, topo: 154.1, x: 499.4 });
  texto(`${horas(dados.cargaTotal)} horas`, { fonte: 'calibri', tam: 11, topo: 154.1, x: 615.0 });

  // tabela
  ret(123.0, 203.9, 729.2, 228.3, MARROM);
  texto('DISCIPLINA / ATIVIDADE PRÁTICA E TEÓRICA', { fonte: 'calibriB', tam: 9.5, cor: '#FFFFFF', topo: 206.9, cx: 280.9 });
  texto('CARGA HORÁRIA', { fonte: 'calibriB', tam: 9.5, cor: '#FFFFFF', topo: 206.9, cx: 501.85 });
  texto('APROVEITAMENTO / NOTA', { fonte: 'calibriB', tam: 9.5, cor: '#FFFFFF', topo: 206.9, cx: 647.05 });
  const linhasY = [[228.8, 251.3], [251.9, 274.5], [275.0, 297.7], [298.2, 320.8], [321.3, 343.9], [344.5, 367.0], [367.5, 390.2], [390.7, 413.4], [413.9, 436.5]];
  DISCIPLINAS.forEach((d, i) => {
    const [y0, y1] = linhasY[i];
    ret(124.0, y0, 728.2, y1, i % 2 === 0 ? '#FFFFFF' : LINHA_PAR);
    ret(124.0, y0 - 0.5, 728.2, y0, MARROM_CLARO);
    texto(d.nome, { fonte: 'calibri', tam: 9, topo: y0 + 1.9, x: 128.9 });
    const v = dados.cargas && String(dados.cargas[d.id] || '').trim().replace('.', ',');
    texto(v ? `${v} h` : '_____ h', { fonte: 'calibri', tam: 9, topo: y0 + 1.9, cx: 501.8 });
    texto('Aprovado', { fonte: 'calibri', tam: 9, topo: y0 + 1.9, cx: 647.2 });
  });
  ret(124.0, 437.0, 728.2, 460.4, TOTAL_FUNDO);
  texto('TOTAL / SITUAÇÃO FINAL:', { fonte: 'calibriB', tam: 9.5, topo: 439.0, direita: 432.5 });
  texto(`${horas(dados.cargaTotal)} h`, { fonte: 'calibriB', tam: 9.5, topo: 439.0, cx: 501.8 });
  texto('APROVADO', { fonte: 'calibriB', tam: 9.5, cor: MARROM, topo: 439.0, cx: 647.1 });
  ret(123.0, 460.4, 729.2, 461.4, MARROM);
  // bordas laterais da tabela
  ret(123.0, 203.9, 124.0, 461.4, MARROM);
  ret(728.3, 203.9, 729.2, 461.4, MARROM);

  doc.moveTo(269.3, 495.2).lineTo(546.6, 495.2).lineWidth(0.6).stroke('#000000');
  texto('MS ADVOCACIA - Visto do Responsável Técnico', { fonte: 'georgia', tam: 9.5, topo: 498.4, cx: 407.9 });

  // ---------- PÁGINA 2 — certificado ----------
  doc.addPage({ size: [W, H], margin: 0 });
  ret(0, 0, W, H, FUNDO);
  doc.image(path.join(DIR, 'borda.png'), 36.0, 29.5, { width: 779.2, height: 532.6 });
  doc.image(path.join(DIR, 'logo.png'), 321.0, 63.05, { width: 182.15, height: 121.49 });
  texto('CERTIFICADO', { fonte: 'georgiaB', tam: 30, cor: MARROM, topo: 174.6, cx: 406.75 });
  texto('A MS ADVOCACIA confere a:', { fonte: 'georgiaB', tam: 13.6, topo: 221.4, cx: 408.5 });

  // linha do nome (o nome vai sobre ela, Calibri 25)
  doc.moveTo(141.0, 283.5).lineTo(707.8, 283.5).lineWidth(0.9).stroke(MARROM);
  if (nomeEst) {
    const tam = tamanhoQueCabe(nomeEst, 'calibri', 25, 560, 14);
    texto(nomeEst, { fonte: 'calibri', tam, topo: 283.5 - tam * 1.13, cx: 424.4 });
  }
  const wA = (() => { doc.font('georgia').fontSize(13.6); return doc.widthOfString('O certificado de participação em '); })();
  const wB = (() => { doc.font('georgiaB').fontSize(14.5); return doc.widthOfString('ESTÁGIO SUPERVISIONADO.'); })();
  const xIni = 406.8 - (wA + wB) / 2;
  texto('O certificado de participação em ', { fonte: 'georgia', tam: 13.6, topo: 291.6, x: xIni });
  texto('ESTÁGIO SUPERVISIONADO.', { fonte: 'georgiaB', tam: 14.5, topo: 290.9, x: xIni + wA });

  const frase = `No período de ${dataPorExtenso(dados.inicio)} até ${dataPorExtenso(dados.fim)}, tendo a carga horária de ${horas(dados.cargaTotal)} horas.`;
  doc.font('calibri').fontSize(12);
  const larguraFrase = 600;
  const alturaFrase = doc.heightOfString(frase, { width: larguraFrase, align: 'center', lineGap: 4 });
  const baseTopo = 321.5 + (2 * 17 - alturaFrase) / 2;
  const asc12 = doc._font.ascender / 1000 * 12;
  doc.fillColor('#000000').text(frase, 408 - larguraFrase / 2, baseTopo + 12 * (1 - 0.25) - asc12, { width: larguraFrase, align: 'center', lineGap: 4 });
  texto('O aproveitamento e grade curricular encontra-se no verso deste certificado.', { fonte: 'georgia', tam: 12, topo: 362.6, cx: 406.7 });
  texto(`Jequié - BA, ${dataPorExtenso(dados.emissao)}.`, { fonte: 'calibri', tam: 12, topo: 398.8, cx: 406.7 });

  // assinaturas
  doc.moveTo(119.5, 448.5).lineTo(350.5, 448.5).lineWidth(0.8).stroke('#000000');
  doc.moveTo(491.5, 448.5).lineTo(722.5, 448.5).lineWidth(0.8).stroke('#000000');
  texto('Estagiário(a)', { fonte: 'georgia', tam: 10.6, topo: 466.0, cx: 235 });
  texto('Advogado(a)', { fonte: 'georgia', tam: 10.6, topo: 466.0, cx: 607 });
  const wCpf = texto('CPF: ', { fonte: 'georgia', tam: 10.6, topo: 489.8, x: 147 });
  if (dados.cpf) texto(dados.cpf, { fonte: 'calibri', tam: 11, topo: 489.5, x: 147 + wCpf });
  else doc.moveTo(147 + wCpf, 499.5).lineTo(300, 499.5).lineWidth(0.6).stroke('#000000');
  const wOab = texto('CPF / OAB: ', { fonte: 'georgia', tam: 10.6, topo: 489.8, x: 514.9 });
  if (dados.advOab) texto(dados.advOab, { fonte: 'calibri', tam: 11, topo: 489.5, x: 514.9 + wOab });
  else doc.moveTo(514.9 + wOab, 499.5).lineTo(700, 499.5).lineWidth(0.6).stroke('#000000');
  texto('Rua Frederico Costa, 124. Centro. Jequié-Ba, CEP: 45.200-225.', { fonte: 'georgiaI', tam: 9.5, cor: '#646464', topo: 523.5, cx: 406.75 });

  doc.end();
  return pronto;
}

/** Dados todos em "X", para o escritório conferir posições e fontes. */
function dadosSimulacao() {
  const cargas = {};
  DISCIPLINAS.forEach((d) => { cargas[d.id] = 'XX'; });
  return { nome: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', cpf: 'XXX.XXX.XXX-XX', inicio: 'XXXX', fim: 'XXXX', cargaTotal: 'XXX', cargas, emissao: 'XXXX', advOab: 'OAB/BA XXXXXX', simulacao: true };
}

module.exports = { gerarCertificadoPdf, dadosSimulacao, DISCIPLINAS, dataPorExtenso, dataCurta };
