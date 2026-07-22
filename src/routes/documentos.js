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

const router = express.Router();

function todayISO() { return new Date().toISOString().slice(0, 10); }

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
    const buffer = renderTemplate('procuracao_template.docx', {
      outorgante_nome: (cliente.nome || '').toUpperCase(),
      outorgante_qualificacao: T.qualificacaoCliente(cliente),
      advogados: advogados.map((a) => ({
        nome: (a.nome || '').toUpperCase(),
        qualificacao: T.qualificacaoAdvogado(a, config.telefone),
      })),
      data_extenso: T.fmtDateExtenso(todayISO()),
    });
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

  let clausulaValor;
  if (tipoValor === 'percentual') {
    const perc = parseFloat(percentual) || 0;
    clausulaValor = `o percentual de ${perc}% (${T.numberToWordsPT(Math.round(perc))} por cento) sobre o proveito econômico da demanda`;
  } else {
    const v = parseFloat(valor) || 0;
    clausulaValor = `a quantia de R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${T.valorPorExtenso(v)})`;
  }
  const nParcelas = parseInt(parcelas, 10) || 1;
  const divisaoTexto = nParcelas > 1
    ? `, dividido em ${nParcelas} (${T.numberToWordsPT(nParcelas)}) parcelas`
    : ', a ser paga à vista';

  try {
    const buffer = renderTemplate('contrato_template.docx', {
      contratante_nome: (cliente.nome || '').toUpperCase(),
      contratante_qualificacao: T.qualificacaoCliente(cliente),
      advogados: advogados.map((a) => ({
        nome: (a.nome || '').toUpperCase(),
        qualificacao: T.qualificacaoAdvogado(a, config.telefone),
      })),
      tipo_processo: (tipoProcesso || '[tipo de processo]').toUpperCase(),
      clausula_valor: clausulaValor,
      divisao_texto: divisaoTexto,
      data_extenso: T.fmtDateExtenso(todayISO()),
    });
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
    if (h.associadoId !== req.user.id && !idsClientes.includes(h.clienteId)) {
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
    honorarios = todosHonorarios.filter((h) => h.associadoId === req.user.id || idsClientes.includes(h.clienteId));
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
    itensRepasse = honorarios.filter((h) => h.associadoId).map((h) => {
      const partes = F.partesSplit(h.splitTipo);
      const recebido = F.valorRecebidoHonorario(h);
      return { texto: `${nomeCli(h.clienteId)} — ${nomeAdv(h.associadoId)}: ${T.fmtMoney(recebido * (partes.associado || 0))} (${h.repasseStatus === 'confirmado' ? 'repassado' : 'aguardando repasse'})` };
    });
  } else {
    const meusHonorarios = honorarios.filter((h) => h.associadoId === req.user.id);
    const t = F.totaisAssociado(meusHonorarios);
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
      const partes = F.partesSplit(h.splitTipo);
      const recebido = F.valorRecebidoHonorario(h);
      const minhaParte = recebido * (partes.associado || 0);
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
