const express = require('express');
const { getCollection, setCollection } = require('../utils/store');
const { requireAuth } = require('../middleware/auth');
const { buscarComunicacoes } = require('../utils/djen');
const { calcularDatasArt224 } = require('../utils/prazoCpc224');
const { triarTextoComIA } = require('../utils/triagemDjen');

const router = express.Router();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Busca ao vivo na API do DJEN — não salva nada ainda, é só consulta.
router.get('/buscar', requireAuth, async (req, res) => {
  const { oab, ufOab, numeroProcesso, siglaTribunal, dataInicio, dataFim, nomeAdvogado, nomeParte, nomeEscritorio, cpfCnpj, pagina } = req.query;
  if (!oab && !numeroProcesso && !nomeAdvogado && !nomeParte && !nomeEscritorio && !cpfCnpj) {
    return res.status(400).json({ erro: 'Informe ao menos um critério de busca (OAB, processo, nome ou CPF/CNPJ).' });
  }
  try {
    const resultado = await buscarComunicacoes({
      oab, ufOab, numeroProcesso, siglaTribunal, dataInicio, dataFim,
      nomeAdvogado, nomeParte, nomeEscritorio, cpfCnpj, pagina: pagina ? parseInt(pagina, 10) : 1,
    });
    // Marca quais itens já foram importados antes, para a tela não deixar importar duplicado.
    const capturadas = await getCollection('djenCapturadas', []);
    const idsJaImportados = new Set(capturadas.map((c) => c.idDjen));
    const items = resultado.items.map((it) => ({ ...it, jaImportado: idsJaImportados.has(it.idDjen) }));
    res.json({ total: resultado.total, items });
  } catch (e) {
    res.status(502).json({ erro: e.message || 'Não foi possível consultar o DJEN agora.' });
  }
});

// Importa um item já buscado: roda a triagem por IA, calcula as datas do
// art. 224 e salva localmente com status "pendente".
router.post('/importar', requireAuth, async (req, res) => {
  const item = req.body || {};
  if (!item.idDjen && !item.texto) return res.status(400).json({ erro: 'Item inválido para importação.' });

  const capturadas = await getCollection('djenCapturadas', []);
  if (capturadas.some((c) => c.idDjen === item.idDjen)) {
    return res.status(409).json({ erro: 'Esta publicação já foi importada anteriormente.' });
  }

  const triagem = await triarTextoComIA(item.texto);
  const datas = item.dataDisponibilizacao
    ? calcularDatasArt224(item.dataDisponibilizacao, triagem.sucesso && triagem.temPrazo ? triagem.prazoDias : null)
    : null;

  const novo = {
    id: uid(),
    idDjen: item.idDjen,
    numeroProcesso: item.numeroProcesso || '',
    tribunal: item.tribunal || '',
    orgaoJulgador: item.orgaoJulgador || '',
    texto: item.texto || '',
    link: item.link || '',
    dataDisponibilizacao: item.dataDisponibilizacao || null,
    dataPublicacao: datas?.dataPublicacao || null,
    dataInicioPrazo: datas?.dataInicioPrazo || null,
    dataFinalPrazo: datas?.dataFinalPrazo || null,
    triagem: triagem.sucesso ? {
      temPrazo: triagem.temPrazo, prazoDias: triagem.prazoDias, prazoUnidade: triagem.prazoUnidade,
      tipoAto: triagem.tipoAto, responsavelNome: triagem.responsavelNome, resumo: triagem.resumo,
    } : null,
    avisoTriagem: triagem.sucesso ? null : triagem.aviso,
    status: 'pendente', // pendente | vinculada | concluida
    processoVinculadoId: null,
    prazoGeradoId: null,
    importadoPor: req.user.id,
    importadoEm: new Date().toISOString(),
    cancelada: false,
  };
  capturadas.push(novo);
  await setCollection('djenCapturadas', capturadas);
  res.status(201).json(novo);
});

// Lista as publicações já capturadas localmente (todo mundo da equipe vê
// todas — é a mesma lógica do resto do sistema para prazos/processos:
// colaborativo dentro do escritório).
router.get('/capturadas', requireAuth, async (req, res) => {
  if (req.user.tipo === 'cliente') return res.status(403).json({ erro: 'Sem acesso.' });
  const capturadas = await getCollection('djenCapturadas', []);
  res.json(capturadas);
});

// Vincula a um processo já cadastrado no sistema.
router.patch('/capturadas/:id/vincular', requireAuth, async (req, res) => {
  if (req.user.tipo === 'cliente') return res.status(403).json({ erro: 'Sem acesso.' });
  const { processoId } = req.body || {};
  if (!processoId) return res.status(400).json({ erro: 'Informe o processo.' });
  const capturadas = await getCollection('djenCapturadas', []);
  const registro = capturadas.find((c) => c.id === req.params.id);
  if (!registro) return res.status(404).json({ erro: 'Registro não encontrado.' });
  registro.processoVinculadoId = processoId;
  registro.status = 'vinculada';
  await setCollection('djenCapturadas', capturadas);
  res.json(registro);
});

// Marca como concluída (o advogado já tratou/gerou a peça/deu ciência).
router.patch('/capturadas/:id/concluir', requireAuth, async (req, res) => {
  if (req.user.tipo === 'cliente') return res.status(403).json({ erro: 'Sem acesso.' });
  const capturadas = await getCollection('djenCapturadas', []);
  const registro = capturadas.find((c) => c.id === req.params.id);
  if (!registro) return res.status(404).json({ erro: 'Registro não encontrado.' });
  registro.status = 'concluida';
  await setCollection('djenCapturadas', capturadas);
  res.json(registro);
});

// Reabre (volta para pendente) — caso tenha marcado como concluída por engano.
router.patch('/capturadas/:id/reabrir', requireAuth, async (req, res) => {
  if (req.user.tipo === 'cliente') return res.status(403).json({ erro: 'Sem acesso.' });
  const capturadas = await getCollection('djenCapturadas', []);
  const registro = capturadas.find((c) => c.id === req.params.id);
  if (!registro) return res.status(404).json({ erro: 'Registro não encontrado.' });
  registro.status = 'pendente';
  registro.processoVinculadoId = null;
  await setCollection('djenCapturadas', capturadas);
  res.json(registro);
});

// Permite corrigir manualmente o prazo (se a IA errou ou não identificou).
router.patch('/capturadas/:id/prazo', requireAuth, async (req, res) => {
  if (req.user.tipo === 'cliente') return res.status(403).json({ erro: 'Sem acesso.' });
  const { prazoDias } = req.body || {};
  const capturadas = await getCollection('djenCapturadas', []);
  const registro = capturadas.find((c) => c.id === req.params.id);
  if (!registro) return res.status(404).json({ erro: 'Registro não encontrado.' });
  const datas = calcularDatasArt224(registro.dataDisponibilizacao, prazoDias ? parseInt(prazoDias, 10) : null);
  registro.dataFinalPrazo = datas?.dataFinalPrazo || null;
  registro.triagem = { ...(registro.triagem || {}), temPrazo: !!prazoDias, prazoDias: prazoDias ? parseInt(prazoDias, 10) : null, prazoUnidade: 'uteis' };
  await setCollection('djenCapturadas', capturadas);
  res.json(registro);
});

module.exports = router;
