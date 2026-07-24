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
function gerarDocxComCorpo(corpoXml) {
  const caminho = path.join(__dirname, '..', '..', 'templates', 'letterhead_base.docx');
  const conteudo = fs.readFileSync(caminho, 'binary');
  const zip = new PizZip(conteudo);
  const documentXmlPath = 'word/document.xml';
  const original = zip.file(documentXmlPath).asText();
  if (!original.includes(MARCADOR_CORPO_VAZIO)) {
    throw new Error('Modelo de timbrado inesperado (marcador do corpo não encontrado).');
  }
  const atualizado = original.replace(MARCADOR_CORPO_VAZIO, corpoXml);
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

    const corpo = [
      D.paragraph(D.run('PROCURAÇÃO', { bold: true, sizeHalfPt: 28 }), { center: true, justify: false }),
      D.blank(),
      D.paragraph([D.run('OUTORGANTE: ', { bold: true }), ...D.montarBlocoPessoas(outorgantes)]),
      D.blank(),
      D.paragraph([D.run('OUTORGADO: ', { bold: true }), ...D.montarBlocoPessoas(outorgados)]),
      D.blank(),
      D.paragraph([
        D.run('PODERES: ', { bold: true }),
        D.run('Por este instrumento particular de procuração, constituo minha bastante procuradora a outorgada, concedendo-lhe os poderes da cláusula ad judicia et extra, para todo o foro em geral, podendo, portanto, promover quaisquer medidas judiciais ou administrativas, em qualquer instância, assinar termos, substabelecer com ou sem reserva de poderes, e praticar, ainda, todos e quaisquer atos necessários e convenientes ao bom e fiel desempenho deste mandato.'),
      ]),
      D.blank(),
      D.paragraph([
        D.run('PODERES ESPECÍFICOS: ', { bold: true }),
        D.run('A presente procuração outorga à Advogada acima descrito, os poderes para receber citação, confessar, reconhecer a procedência do pedido, transigir, desistir, renunciar ao direito sobre o qual se funda a ação, receber Alvará, dar quitação, firmar compromisso, pedir a justiça gratuita, assinar declaração de hipossuficiência econômica e assinar declaração de isenção de imposto de renda. (Em conformidade com a norma do art. 105 do NCPC15). Os poderes específicos acima outorgados poderão ser substabelecidos. Ademais, constitui o exercício da advocacia como atividade meio, não podendo o advogado garantir nenhum resultado valorável ao cliente.'),
      ]),
      D.blank(), D.blank(),
      D.paragraph(D.run(`Jequié-Ba, ${T.fmtDateExtenso(todayISO())}.`), { indentCm: 2, justify: false }),
      D.blank(), D.blank(),
      D.paragraph(D.run('____________________________________________'), { center: true, justify: false }),
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

  const TERMOS_DESTAQUE = ['O ADVOGADO', 'ADVOGADO', 'OUTORGANTE', tipoProcessoUpper];

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
      D.paragraph(D.run('Tem justo e contratado o seguinte:')),
      D.blank(),
      D.paragraph(D.comDestaques(`1. O ADVOGADO, face ao mandato judicial que lhe foi outorgado, se obriga a prestar os seus serviços profissionais na defesa dos direitos do OUTORGANTE, no ${tipoProcessoUpper}, em qualquer juízo, instância ou Tribunal, devendo desincumbir-se com zelo a atividade do seu encargo.`, TERMOS_DESTAQUE)),
      D.blank(),
      D.paragraph([
        ...D.comDestaques('2. O OUTORGANTE pagará ao ADVOGADO, a título de honorários/remuneração pelos seus serviços contratados, ', TERMOS_DESTAQUE),
        ...runsValor, ...runsDivisao, D.run('.'),
      ]),
      D.paragraph(D.comDestaques('§1º. Os honorários porventura recebidos da parte contrária, como sucumbência, pertencerão ao ADVOGADO.', TERMOS_DESTAQUE)),
      D.blank(),
      D.paragraph(D.comDestaques('3. O OUTORGANTE deverá fornecer ao ADVOGADO os documentos, informações e rol de testemunhas necessárias ao bom e rápido andamento da ação ou para satisfazer exigências do processo ou atividades extrajudiciais, dentro dos prazos legais.', TERMOS_DESTAQUE)),
      D.paragraph(D.comDestaques('Parágrafo Primeiro: O OUTORGANTE fica obrigado a comparecer à audiência e perícia médica, sob pena de arcar com as custas e emolumentos cobrados pelo Juízo.', TERMOS_DESTAQUE)),
      D.paragraph(D.comDestaques('Parágrafo segundo: Ficará o ADVOGADO isento de qualquer responsabilidade pela entrega de documentos e cumprimento das exigências acima, quando feitas fora dos prazos estabelecidos por lei.', TERMOS_DESTAQUE)),
      D.blank(),
      D.paragraph(D.comDestaques('4. O OUTORGANTE expressamente confirma que tem ciência de que o presente contrato é de prestação de serviços advocatícios e que os honorários serão adimplidos somente em caso de êxito da demanda, descrito no item 2.', TERMOS_DESTAQUE)),
      D.blank(),
      D.paragraph([
        D.run('Fica eleito o foro da '),
        D.run('Comarca de JEQUIÉ/BA', { bold: true }),
        D.run(' para dirimir qualquer dúvida referente a este contrato. E, por estarem as partes assim contratadas, firmam o presente contrato particular.'),
      ]),
      D.blank(), D.blank(),
      D.paragraph(D.run(`Jequié/BA, ${T.fmtDateExtenso(todayISO())}.`), { indentCm: 2, justify: false }),
      D.blank(), D.blank(),
      D.paragraph(D.run('_____________________________________________________________'), { center: true, justify: false }),
      D.paragraph(D.run('CONTRATANTE', { bold: true }), { center: true, justify: false }),
      D.blank(),
      D.paragraph(D.run('_____________________________________________________________'), { center: true, justify: false }),
      D.paragraph(D.run('CONTRATADO', { bold: true }), { center: true, justify: false }),
    ].join('');

    const buffer = gerarDocxComCorpo(corpo);
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

  let honorarios;
  if (isMaster(req.user) || isSocio(req.user)) {
    honorarios = todosHonorarios;
  } else if (isAssociado(req.user)) {
    const idsClientes = clientes.filter((c) => c.vinculoId === req.user.id).map((c) => c.id);
    honorarios = todosHonorarios.filter((h) => F.idsProfissionais(h).includes(req.user.id) || idsClientes.includes(h.clienteId));
  } else {
    return res.status(403).json({ erro: 'Perfil sem acesso a relatórios financeiros.' });
  }

  let resumoLinhas = [];
  let itensRepasse = [];

  if (isMaster(req.user) || isSocio(req.user)) {
    const r = F.resumoEscritorio(honorarios, despesasTodas, periodo);
    resumoLinhas = [
      { texto: `Recebido no período (parte do escritório): ${T.fmtMoney(r.recebidoPeriodo)}` },
      { texto: `Despesas no período: ${T.fmtMoney(r.despesasPeriodo)}` },
      { texto: `Saldo do período: ${T.fmtMoney(r.saldoPeriodo)}` },
      { texto: `Caixa acumulado do escritório: ${T.fmtMoney(r.caixaAcumulado)}` },
    ];
    const usuarios = await getCollection('usuarios', []);
    const nomeAdv = (id) => { const u = usuarios.find((x) => x.id === id); return u ? u.nome : '—'; };
    const nomeCli = (id) => { const c = clientes.find((x) => x.id === id); return c ? c.nome : '—'; };
    itensRepasse = honorarios.filter((h) => F.idsProfissionais(h).length).map((h) => {
      const ids = F.idsProfissionais(h);
      const partesTexto = ids.map((id) => `${nomeAdv(id)}: ${T.fmtMoney(F.parteDoProfissional(h, id))}`).join(' · ');
      return { texto: `${nomeCli(h.clienteId)} — ${partesTexto} (${h.repasseStatus === 'confirmado' ? 'repassado' : 'aguardando repasse'})` };
    });
  } else {
    const meusHonorarios = honorarios.filter((h) => F.idsProfissionais(h).includes(req.user.id));
    const t = F.totaisAssociado(meusHonorarios, req.user.id);
    resumoLinhas = [
      { texto: `Total dos contratos fechados: ${T.fmtMoney(t.totalContrato)}` },
      { texto: `Recebido dos clientes: ${T.fmtMoney(t.totalRecebidoCliente)}` },
      { texto: `Sua parte já repassada a você: ${T.fmtMoney(t.minhaParteRepassada)}` },
      { texto: `Sua parte aguardando repasse: ${T.fmtMoney(t.minhaParteAguardando)}` },
    ];
    const processos = await getCollection('processos', []);
    const nomeCli = (id) => { const c = clientes.find((x) => x.id === id); return c ? c.nome : '—'; };
    const numProc = (id) => { const p = processos.find((x) => x.id === id); return p ? p.numero : ''; };
    itensRepasse = meusHonorarios.map((h) => {
      const minhaParte = F.parteDoProfissional(h, req.user.id);
      const recebido = F.valorRecebidoHonorario(h);
      return { texto: `${nomeCli(h.clienteId)}${h.processoId ? ' — ' + numProc(h.processoId) : ''}: contrato ${T.fmtMoney(h.valorTotal)}, recebido ${T.fmtMoney(recebido)}, sua parte ${T.fmtMoney(minhaParte)} (${h.repasseStatus === 'confirmado' ? 'repassado' : 'aguardando repasse'})` };
    });
  }

  try {
    const buffer = renderTemplate('relatorio_template.docx', {
      periodo_inicio: periodoInicio.split('-').reverse().join('/'),
      periodo_fim: periodoFim.split('-').reverse().join('/'),
      data_emissao: T.fmtDateExtenso(todayISO()),
      emitido_por: req.user.nome,
      resumoLinhas,
      itensRepasse,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="Relatorio Financeiro.docx"');
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Não foi possível gerar o relatório.' });
  }
});

module.exports = router;
