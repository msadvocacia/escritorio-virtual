const express = require('express');
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const { getCollection } = require('../utils/store');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isAssociado, isMaster, isSocio, isCliente } = require('../utils/visibility');
const F = require('../utils/financeiro');
const T = require('../utils/textoJuridico');
const D = require('../utils/docxBuilder');

const router = express.Router();

function todayISO() { return new Date().toISOString().slice(0, 10); }

const MARCADOR_CORPO_VAZIO = '<w:p w:rsidR="00DB1E63" w:rsidRPr="00B565BB" w:rsidRDefault="00DB1E63" w:rsidP="00B565BB"><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/></w:p>';

// Monta um .docx a partir do timbrado real (cabeçalho/rodapé/logo preservados),
// inserindo o corpo do documento (já em XML pronto, ver src/utils/docxBuilder.js)
// no lugar do parágrafo vazio do arquivo-base. Usado por procuração e contrato,
// que precisam de controle fino de negrito/caixa alta por trecho — algo que o
// docxtemplater (usado no recibo/relatório) não permite fazer dinamicamente
// quando o número de pessoas no parágrafo muda a cada processo.
function gerarDocxComCorpo(corpoXml, { margemInferiorTwips } = {}) {
  const caminho = path.join(__dirname, '..', '..', 'templates', 'letterhead_base.docx');
  const conteudo = fs.readFileSync(caminho, 'binary');
  const zip = new PizZip(conteudo);
  const documentXmlPath = 'word/document.xml';
  let atualizado = zip.file(documentXmlPath).asText();
  if (!atualizado.includes(MARCADOR_CORPO_VAZIO)) {
    throw new Error('Modelo de timbrado inesperado (marcador do corpo não encontrado).');
  }
  atualizado = atualizado.replace(MARCADOR_CORPO_VAZIO, corpoXml);
  if (margemInferiorTwips) {
    atualizado = atualizado.replace(/(<w:pgMar[^>]*w:bottom=")\d+(")/, `$1${margemInferiorTwips}$2`);
  }
  zip.file(documentXmlPath, atualizado);
  return zip.generate({ type: 'nodebuffer' });
}

function renderTemplate(templateFile, dados) {
  const caminho = path.join(__dirname, '..', '..', 'templates', templateFile);
  const conteudo = fs.readFileSync(caminho, 'binary');
  const zip = new PizZip(conteudo);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render(dados);
  return doc.getZip().generate({ type: 'nodebuffer' });
}

async function carregarClienteEAdvogados(req, res, clienteId, advogadoIds) {
  const clientes = await getCollection('clientes', []);
  const cliente = clientes.find((c) => c.id === clienteId);
  if (!cliente) { res.status(404).json({ erro: 'Cliente não encontrado.' }); return null; }
  if (isAssociado(req.user) && cliente.vinculoId !== req.user.id) {
    res.status(403).json({ erro: 'Você só pode gerar documentos dos seus próprios clientes.' }); return null;
  }
  const usuarios = await getCollection('usuarios', []);
  const advogados = usuarios.filter((u) => (advogadoIds || []).includes(u.id) && (u.tipo === 'socio' || u.tipo === 'associado'));
  if (!advogados.length) { res.status(400).json({ erro: 'Selecione ao menos um advogado.' }); return null; }
  const config = await getCollection('config', {});
  return { cliente, advogados, config };
}

router.post('/procuracao', requireAuth, requireRole('master', 'socio', 'associado'), async (req, res) => {
  const { clienteId, advogadoIds } = req.body || {};
  if (!clienteId) return res.status(400).json({ erro: 'Informe o cliente.' });

  const carregado = await carregarClienteEAdvogados(req, res, clienteId, advogadoIds);
  if (!carregado) return;
  const { cliente, advogados, config } = carregado;

  try {
    const outorgantes = [{
      nome: (cliente.nome || '').toUpperCase(),
      qualificacaoSemEndereco: T.qualificacaoClienteSemEndereco(cliente),
      endereco: T.enderecoCompleto(cliente) || '—',
    }];
    const outorgados = advogados.map((a) => ({
      nome: (a.nome || '').toUpperCase(),
      qualificacaoSemEndereco: T.qualificacaoAdvogadoSemEndereco(a, config.telefone),
      endereco: T.enderecoAdvogado(),
    }));

    const PODERES_TEXTO = 'Por este instrumento particular de procuração, constituo meu bastante procurador o outorgado, concedendo-lhe os poderes inerentes da CLÁUSULA AD JUDITIA ET EXTRA, para o foro em geral, podendo, portanto, promover quaisquer medidas judiciais ou administrativas, assinar termo, oferecer defesa, direta ou indireta, interpor recursos, ajuizar ações e conduzir os respectivos processos, solicitar, providenciar, receber e ter acesso a documentos de qualquer natureza, sendo o presente instrumento de mandato oneroso e contratual podendo substabelecer este a outrem, com ou sem reserva de poderes, dando tudo por bom e valioso, a fim de praticar todos os demais atos necessários ao fiel desempenho deste mandato.';
    const PODERES_ESPECIFICOS_TEXTO = 'A presente procuração outorga o Advogado acima descrito, os poderes especiais para receber citação, confessar, reconhecer a procedência do pedido, transigir, desistir, renunciar ao direito sobre que se funda a ação, firmar compromissos ou acordos, receber valores/dinheiro, dar e receber quitação, levantar ou receber RPV e ALVARÁS, pedir à justiça gratuita e assinar declaração de hipossuficiência econômica, em conformidade com a norma do art. 105 da Lei 13.105/2015.';

    // Estima o tamanho do corpo para decidir entre 11,5 e 11 — evita que só a
    // data/assinatura vazem para uma segunda página. Calibrado testando casos
    // reais (1 outorgado cabe em 1 página a 11,5; 2+ outorgados só cabem a 11).
    const tamanhoEstimado = outorgantes.reduce((s, p) => s + p.nome.length + p.qualificacaoSemEndereco.length, 0)
      + outorgados.reduce((s, p) => s + p.nome.length + p.qualificacaoSemEndereco.length, 0)
      + PODERES_TEXTO.length + PODERES_ESPECIFICOS_TEXTO.length;
    const PROC_SZ = tamanhoEstimado > 1450 ? 22 : 23; // 22=11pt, 23=11,5pt
    const corpo = [
      D.paragraph(D.run('PROCURAÇÃO', { bold: true, sizeHalfPt: 28 }), { center: true, justify: false }),
      D.blank(),
      D.paragraph([D.run('OUTORGANTE: ', { bold: true, sizeHalfPt: PROC_SZ }), ...D.montarBlocoPessoas(outorgantes, PROC_SZ)]),
      D.blank(),
      D.paragraph([D.run('OUTORGADO: ', { bold: true, sizeHalfPt: PROC_SZ }), ...D.montarBlocoPessoas(outorgados, PROC_SZ)]),
      D.blank(),
      D.paragraph([
        D.run('PODERES: ', { bold: true, sizeHalfPt: PROC_SZ }),
        D.run(PODERES_TEXTO, { sizeHalfPt: PROC_SZ }),
      ]),
      D.blank(),
      D.paragraph([
        D.run('PODERES ESPECÍFICOS: ', { bold: true, sizeHalfPt: PROC_SZ }),
        D.run(PODERES_ESPECIFICOS_TEXTO, { sizeHalfPt: PROC_SZ }),
      ]),
      D.blank(),
      D.paragraph(D.run(`Jequié-Ba, ${T.fmtDateExtenso(todayISO())}.`, { sizeHalfPt: PROC_SZ }), { indentCm: 2, justify: false }),
      D.blank(), D.blank(),
      D.paragraph(D.run('____________________________________________', { sizeHalfPt: PROC_SZ }), { center: true, justify: false }),
    ].join('');

    const buffer = gerarDocxComCorpo(corpo);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Procuracao - ${cliente.nome.replace(/[^\w\- ]/g, '')}.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Não foi possível gerar o documento.' });
  }
});

router.post('/contrato', requireAuth, requireRole('master', 'socio', 'associado'), async (req, res) => {
  const { clienteId, advogadoIds, tipoProcesso, tipoValor, valor, percentual, parcelas } = req.body || {};
  if (!clienteId) return res.status(400).json({ erro: 'Informe o cliente.' });

  const carregado = await carregarClienteEAdvogados(req, res, clienteId, advogadoIds);
  if (!carregado) return;
  const { cliente, advogados, config } = carregado;

  const contratantes = [{
    nome: (cliente.nome || '').toUpperCase(),
    qualificacaoSemEndereco: T.qualificacaoClienteSemEndereco(cliente),
    endereco: T.enderecoCompleto(cliente) || '—',
  }];
  const contratados = advogados.map((a) => ({
    nome: (a.nome || '').toUpperCase(),
    qualificacaoSemEndereco: T.qualificacaoAdvogadoSemEndereco(a, config.telefone),
    endereco: T.enderecoAdvogado(),
  }));

  const tipoProcessoUpper = (tipoProcesso || '[TIPO DE PROCESSO]').toUpperCase();

  // Runs do valor (negrito), separados do resto da frase (que fica normal),
  // já que o valor precisa ficar em negrito tanto em algarismo quanto por extenso.
  let runsValor;
  if (tipoValor === 'percentual') {
    const perc = parseFloat(percentual) || 0;
    runsValor = [
      D.run('o percentual de '),
      D.run(`${perc}% (${T.numberToWordsPT(Math.round(perc))} por cento)`, { bold: true }),
      D.run(' sobre o proveito econômico da demanda'),
    ];
  } else {
    const v = parseFloat(valor) || 0;
    runsValor = [
      D.run('a quantia de '),
      D.run(`R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${T.valorPorExtenso(v)})`, { bold: true }),
    ];
  }
  const nParcelas = parseInt(parcelas, 10) || 1;
  const runsDivisao = nParcelas > 1
    ? [D.run(', dividido em '), D.run(`${nParcelas} (${T.numberToWordsPT(nParcelas)})`, { bold: true }), D.run(' parcelas')]
    : [D.run(', a ser paga à vista')];

  const TERMOS_DESTAQUE = ['O ADVOGADO', 'ADVOGADO', 'OUTORGANTE', 'CONTRATANTE', 'CONTRATADOS', 'CONTRATADO', tipoProcessoUpper];

  try {
    const corpo = [
      D.paragraph(D.run('CONTRATO PARTICULAR DE PRESTAÇÃO DE SERVIÇOS E HONORÁRIOS ADVOCATÍCIOS', { bold: true, sizeHalfPt: 24 }), { center: true, justify: false }),
      D.blank(), D.blank(),
      D.paragraph(D.run('Neste ato e na melhor forma de direito, tem o presente instrumento Contrato Particular de Prestação de Serviços e Honorários Advocatícios:'), { center: true, justify: false }),
      D.blank(),
      D.paragraph([D.run('CONTRATANTE: ', { bold: true }), ...D.montarBlocoPessoas(contratantes)]),
      D.blank(),
      D.paragraph([D.run('CONTRATADO: ', { bold: true }), ...D.montarBlocoPessoas(contratados)]),
      D.blank(),
      D.paragraph(D.run('As partes acima identificadas têm, entre si, justo e acertado o presente Contrato de Honorários Advocatícios, que se regerá pelas cláusulas e pelas condições a seguir descritas.')),
      D.blank(),
      D.paragraph(D.run('DO OBJETO DO CONTRATO', { bold: true }), { center: true, justify: false }),
      D.blank(),
      D.paragraph(D.comDestaques(`Cláusula 1ª. O ADVOGADO, face ao mandato judicial que lhe foi outorgado, se obriga a prestar os seus serviços profissionais na defesa dos direitos do OUTORGANTE, no ${tipoProcessoUpper}, em qualquer juízo, instância ou Tribunal, devendo desincumbir-se com zelo a atividade do seu encargo.`, TERMOS_DESTAQUE)),
      D.blank(),
      D.paragraph(D.run('DAS ATIVIDADES', { bold: true }), { center: true, justify: false }),
      D.blank(),
      D.paragraph(D.comDestaques('Cláusula 2ª. O CONTRATADO deverá praticar todos os atos relacionados ao exercício da advocacia, obrigações tipicamente de meio, particularmente aqueles constantes no Estatuto da OAB, assim como o que for especificado na outorga da procuração, com a diligência habitual que se presume da atuação profissional.', TERMOS_DESTAQUE)),
      D.blank(),
      D.paragraph(D.run('DOS ATOS PROCESSUAIS', { bold: true }), { center: true, justify: false }),
      D.blank(),
      D.paragraph(D.comDestaques('Cláusula 3ª. Havendo necessidade de contratação de outros profissionais no decurso do processo, o CONTRATADO elaborará substabelecimento, indicando advogado de sua confiança, para auxiliá-lo na defesa dos interesses da CONTRATANTE, correndo as despesas decorrentes desta delegação às expensas da CONTRATANTE.', TERMOS_DESTAQUE)),
      D.blank(),
      D.paragraph(D.run('DAS DESPESAS', { bold: true }), { center: true, justify: false }),
      D.blank(),
      D.paragraph(D.comDestaques('Cláusula 4ª. Todas as despesas efetuadas pelo CONTRATADO, mesmo que indiretamente relacionadas com a sua atuação, incluindo-se cópias, digitalizações, envio de correspondência, emolumentos, viagens, estacionamento, custas, preparo e demais gastos de natureza diversa da verba honorária, ficarão a expensas da CONTRATANTE, desde que previamente por autorizadas.', TERMOS_DESTAQUE)),
      D.paragraph(D.comDestaques('Cláusula 5ª. Todas as despesas serão acompanhadas de documento comprobatório, devidamente organizado pelo CONTRATADO.', TERMOS_DESTAQUE)),
      D.blank(),
      D.paragraph(D.run('DOS HONORÁRIOS', { bold: true }), { center: true, justify: false }),
      D.blank(),
      D.paragraph([
        ...D.comDestaques('Cláusula 6ª. O CONTRATANTE, como contraprestação aos serviços jurídicos prestados, pagará ao CONTRATADO, a título de pro labore, ', TERMOS_DESTAQUE),
        ...runsValor, ...runsDivisao, D.run('.'),
      ]),
      D.blank(),
      D.paragraph(D.comDestaques('Cláusula 7ª. Os honorários de sucumbência pertencem ao CONTRATADO e não se confundem com os honorários contratuais aqui tratados.', TERMOS_DESTAQUE)),
      D.paragraph(D.comDestaques('Parágrafo único. Caso haja morte ou incapacidade civil do CONTRATADO, seus sucessores ou representante(s) legal(s) receberão os honorários na proporção do trabalho realizado.', TERMOS_DESTAQUE)),
      D.blank(),
      D.paragraph(D.comDestaques('Cláusula 8ª. Havendo acordo entre a CONTRATANTE e a parte contrária ou desistência pela CONTRATANTE, este fato não prejudicará o recebimento de todos os honorários CONTRATADOS e da sucumbência, se houver, pelo CONTRATADO.', TERMOS_DESTAQUE)),
      D.blank(),
      D.paragraph(D.run('DA VIGÊNCIA E DA RESCISÃO', { bold: true }), { center: true, justify: false }),
      D.blank(),
      D.paragraph(D.run('Cláusula 9ª. O presente contrato terá a duração até o final do processo e o adimplemento das obrigações ajustadas, podendo ser rescindido a qualquer tempo por qualquer das partes, mediante aviso prévio de 30 (trinta) dias, por escrito e com comprovante de entrega.')),
      D.blank(),
      D.paragraph(D.run('DA RESPONSABILIDADE', { bold: true }), { center: true, justify: false }),
      D.blank(),
      D.paragraph(D.comDestaques('Cláusula 10ª. o CONTRATADO não será responsabilizada por quaisquer danos que sobrevierem das demandas que patrocinar, cabendo-lhe tão somente o emprego diligente de seus conhecimentos, meios e técnicas para a defesa dos interesses da CONTRATANTE, inexistente qualquer garantia de resultado.', TERMOS_DESTAQUE)),
      D.paragraph(D.comDestaques('Cláusula 11ª. O CONTRATADO não será responsabilizada acaso resultem danos por não tomar conhecimento de informações e documentos substanciais para a sua atividade ou em decorrência da impossibilidade de contato com a CONTRATANTE, que deverá manter atualizadas quaisquer informações relevantes para a demanda, bem como as informações cadastrais fornecidas por aquele.', TERMOS_DESTAQUE)),
      D.paragraph(D.comDestaques('Cláusula 12ª. É obrigação da CONTRATANTE, sempre que solicitada, entregar, fornecer ou disponibilizar ao CONTRATADO todos os documentos necessários, provas, informações e subsídios, em tempo hábil, para que este possa cumprir o objeto do presente contrato. Qualquer omissão ou negligência por parte da CONTRATANTE será de sua inteira responsabilidade, caso advenha algum prejuízo a seus interesses.', TERMOS_DESTAQUE)),
      D.blank(),
      D.paragraph(D.run('DO FORO', { bold: true }), { center: true, justify: false }),
      D.blank(),
      D.paragraph([
        D.run('Cláusula 13ª. Para dirimir quaisquer controvérsias oriundas deste contrato, as partes elegem o foro da '),
        D.run('comarca de Jequié/BA', { bold: true }),
        D.run('.'),
      ]),
      D.blank(),
      D.paragraph(D.run('Por estarem assim justos e contratados, firmam o presente instrumento, em duas vias de igual teor.')),
      D.blank(),
      D.paragraph(D.run(`Jequié/BA, ${T.fmtDateExtenso(todayISO())}.`), { indentCm: 2, justify: false }),
      D.blank(), D.blank(),
      ...contratantes.map((p) => [
        D.paragraph(D.run('_____________________________________________________________'), { center: true, justify: false }),
        D.paragraph(D.run(p.nome, { bold: true }), { center: true, justify: false }),
        D.paragraph(D.run('(CONTRATANTE)', { bold: true }), { center: true, justify: false }),
        D.blank(),
      ]).flat(),
      ...contratados.map((p, i) => [
        D.paragraph(D.run('_____________________________________________________________'), { center: true, justify: false }),
        D.paragraph(D.run(p.nome, { bold: true }), { center: true, justify: false }),
        D.paragraph(D.run(`(OAB/BA - ${advogados[i].oab || '—'})`), { center: true, justify: false }),
        D.paragraph(D.run('(CONTRATADO)', { bold: true }), { center: true, justify: false }),
        D.blank(),
      ]).flat(),
    ].join('');

    const buffer = gerarDocxComCorpo(corpo, { margemInferiorTwips: 1843 }); // +0,5cm na margem inferior (texto estava grudando no rodapé)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Contrato - ${cliente.nome.replace(/[^\w\- ]/g, '')}.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Não foi possível gerar o documento.' });
  }
});

router.post('/recibo', requireAuth, async (req, res) => {
  const { honorarioId, parcelaId } = req.body || {};
  if (!honorarioId) return res.status(400).json({ erro: 'Informe o honorário.' });

  const honorarios = await getCollection('honorarios', []);
  const h = honorarios.find((x) => x.id === honorarioId);
  if (!h) return res.status(404).json({ erro: 'Honorário não encontrado.' });

  if (isAssociado(req.user)) {
    const clientes = await getCollection('clientes', []);
    const idsClientes = clientes.filter((c) => c.vinculoId === req.user.id).map((c) => c.id);
    if (!F.idsProfissionais(h).includes(req.user.id) && !idsClientes.includes(h.clienteId)) {
      return res.status(403).json({ erro: 'Você não tem acesso a este honorário.' });
    }
  } else if (isCliente(req.user)) {
    if (h.clienteId !== req.user.clienteId) return res.status(403).json({ erro: 'Você não tem acesso a este honorário.' });
  }

  const clientes = await getCollection('clientes', []);
  const cliente = clientes.find((c) => c.id === h.clienteId);
  const processos = await getCollection('processos', []);
  const processo = processos.find((p) => p.id === h.processoId);
  const desc = h.descricao || `honorários referentes a ${cliente ? cliente.nome : 'cliente'}`;
  const procTxt = processo ? `, processo nº ${processo.numero}` : '';

  let valor, referencia;
  if (parcelaId) {
    const p = (h.parcelas || []).find((x) => x.id === parcelaId);
    if (!p) return res.status(404).json({ erro: 'Parcela não encontrada.' });
    valor = p.valor;
    referencia = `parcela ${p.numero} de ${h.parcelas.length} referente a "${desc}"${procTxt}`;
  } else {
    valor = h.valorTotal;
    referencia = `quitação integral de "${desc}"${procTxt}`;
  }

  try {
    const buffer = renderTemplate('recibo_template.docx', {
      valor_formatado: T.fmtMoney(valor),
      cliente_nome: (cliente ? cliente.nome : '').toUpperCase(),
      valor_numero: valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      valor_extenso: T.valorPorExtenso(valor),
      referencia,
      data_extenso: T.fmtDateExtenso(todayISO()),
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Recibo - ${(cliente ? cliente.nome : 'cliente').replace(/[^\w\- ]/g, '')}.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Não foi possível gerar o recibo.' });
  }
});

router.post('/relatorio', requireAuth, async (req, res) => {
  const { periodoInicio, periodoFim } = req.body || {};
  if (!periodoInicio || !periodoFim) return res.status(400).json({ erro: 'Informe o período (início e fim).' });
  const periodo = { inicio: periodoInicio, fim: periodoFim };

  const todosHonorarios = await getCollection('honorarios', []);
  const clientes = await getCollection('clientes', []);
  const despesasTodas = await getCollection('despesas', []);
  const usuarios = await getCollection('usuarios', []);
  const nomeAdv = (id) => { const u = usuarios.find((x) => x.id === id); return u ? u.nome : '—'; };
  const nomeCli = (id) => { const c = clientes.find((x) => x.id === id); return c ? c.nome : '—'; };

  let honorarios;
  if (isMaster(req.user) || isSocio(req.user)) {
    honorarios = todosHonorarios;
  } else if (isAssociado(req.user)) {
    const idsClientes = clientes.filter((c) => c.vinculoId === req.user.id).map((c) => c.id);
    honorarios = todosHonorarios.filter((h) => F.idsProfissionais(h).includes(req.user.id) || idsClientes.includes(h.clienteId));
  } else {
    return res.status(403).json({ erro: 'Perfil sem acesso a relatórios financeiros.' });
  }

  // campos: rótulo (caixa alta e negrito) + valor (negrito)
  let campos = [];
  let linhasTabela = []; // [{ cliente, profissional, valor, status }]

  if (isMaster(req.user) || isSocio(req.user)) {
    const r = F.resumoEscritorio(honorarios, despesasTodas, periodo);
    campos = [
      { label: 'RECEBIDO NO PERÍODO (PARTE DO ESCRITÓRIO)', valor: T.fmtMoney(r.recebidoPeriodo) },
      { label: 'DESPESAS DO PERÍODO', valor: T.fmtMoney(r.despesasPeriodo) },
      { label: 'SALDO DO PERÍODO', valor: T.fmtMoney(r.saldoPeriodo) },
      { label: 'CAIXA ACUMULADO DO ESCRITÓRIO', valor: T.fmtMoney(r.caixaAcumulado) },
    ];
    honorarios.filter((h) => F.idsProfissionais(h).length).forEach((h) => {
      F.idsProfissionais(h).forEach((id) => {
        const valorNum = F.parteDoProfissional(h, id);
        linhasTabela.push({
          cliente: nomeCli(h.clienteId), profissional: nomeAdv(id),
          valor: T.fmtMoney(valorNum), valorNum, confirmado: h.repasseStatus === 'confirmado',
        });
      });
    });
  } else {
    const meusHonorarios = honorarios.filter((h) => F.idsProfissionais(h).includes(req.user.id));
    const t = F.totaisAssociado(meusHonorarios, req.user.id);
    campos = [
      { label: 'TOTAL DOS CONTRATOS FECHADOS', valor: T.fmtMoney(t.totalContrato) },
      { label: 'RECEBIDO DOS CLIENTES', valor: T.fmtMoney(t.totalRecebidoCliente) },
      { label: 'SUA PARTE JÁ REPASSADA A VOCÊ', valor: T.fmtMoney(t.minhaParteRepassada) },
      { label: 'SUA PARTE AGUARDANDO REPASSE', valor: T.fmtMoney(t.minhaParteAguardando) },
    ];
    meusHonorarios.forEach((h) => {
      const valorNum = F.parteDoProfissional(h, req.user.id);
      linhasTabela.push({
        cliente: nomeCli(h.clienteId), profissional: nomeAdv(req.user.id),
        valor: T.fmtMoney(valorNum), valorNum, confirmado: h.repasseStatus === 'confirmado',
      });
    });
  }

  linhasTabela.sort((a, b) => a.cliente.localeCompare(b.cliente, 'pt-BR'));
  const totalRepassado = linhasTabela.filter((l) => l.confirmado).reduce((s, l) => s + l.valorNum, 0);
  const totalAguardando = linhasTabela.filter((l) => !l.confirmado).reduce((s, l) => s + l.valorNum, 0);

  try {
    const SZ = 23; // 11,5pt
    const corpo = [
      D.paragraph(D.run('RELATÓRIO FINANCEIRO', { bold: true, sizeHalfPt: 28 }), { center: true, justify: false }),
      D.blank(),
      D.paragraph([
        D.run('PERÍODO: ', { bold: true, sizeHalfPt: SZ }),
        D.run(`${periodoInicio.split('-').reverse().join('/')} a ${periodoFim.split('-').reverse().join('/')}. `, { sizeHalfPt: SZ }),
        D.run('Emitido em ', { sizeHalfPt: SZ }),
        D.run(T.fmtDateExtenso(todayISO()), { sizeHalfPt: SZ }),
        D.run(' por ', { sizeHalfPt: SZ }),
        D.run(req.user.nome, { sizeHalfPt: SZ }),
        D.run('.', { sizeHalfPt: SZ }),
      ]),
      D.blank(),
      ...campos.map((c) => D.paragraph([
        D.run(c.label + ': ', { bold: true, sizeHalfPt: SZ }),
        D.run(c.valor, { bold: true, sizeHalfPt: SZ }),
      ])),
      D.blank(),
      D.paragraph(D.run('REPASSES POR PROCESSO', { bold: true, sizeHalfPt: SZ })),
      D.blank(),
      linhasTabela.length
        ? D.tabela(
            ['Cliente', 'Profissional', 'Valor', 'Status'],
            linhasTabela.map((l) => [l.cliente, l.profissional, D.run(l.valor, { bold: true, sizeHalfPt: SZ }), l.confirmado ? 'Repassado' : 'Aguardando repasse']),
            { largurasCm: [5, 5, 3, 3.5] }
          )
        : D.paragraph(D.run('Nenhum processo com profissional vinculado neste período.', { sizeHalfPt: SZ })),
      D.blank(),
      D.paragraph([D.run('Total repassado: ', { bold: true, sizeHalfPt: SZ }), D.run(T.fmtMoney(totalRepassado), { bold: true, sizeHalfPt: SZ })]),
      D.paragraph([D.run('Total aguardando repasse: ', { bold: true, sizeHalfPt: SZ }), D.run(T.fmtMoney(totalAguardando), { bold: true, sizeHalfPt: SZ })]),
    ].join('');

    const buffer = gerarDocxComCorpo(corpo);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="Relatorio Financeiro.docx"');
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Não foi possível gerar o relatório.' });
  }
});

module.exports = router;
