const express = require('express');
const { getCollection, setCollection } = require('../utils/store');
const { requireAuth } = require('../middleware/auth');
const { isMaster, isSocio, isAssociado, isEstagiario } = require('../utils/visibility');

const router = express.Router();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Os 10 critérios de avaliação de cada missão — cada um vai de 0 a 10; a nota
// final da missão é a média. O "conjunto de opções" de cada critério é o
// mesmo (baixa/razoável/alta/altíssima/ignorado), convertido em pontos na
// hora de calcular (baixa dificuldade = nota alta, dificuldade altíssima =
// nota baixa — ver ESCALA_DIFICULDADE abaixo).
const CRITERIOS_AVALIACAO = [
  { chave: 'entendimento', label: 'Dificuldade de entendimento da tarefa' },
  { chave: 'execucao', label: 'Dificuldade na execução' },
  { chave: 'escrita', label: 'Dificuldade na escrita/redação' },
  { chave: 'pesquisa', label: 'Dificuldade na pesquisa jurídica' },
  { chave: 'prazo', label: 'Cumprimento do prazo estabelecido' },
  { chave: 'autonomia', label: 'Autonomia (precisou de ajuda constante?)' },
  { chave: 'qualidade', label: 'Qualidade técnica do material entregue' },
  { chave: 'organizacao', label: 'Organização e clareza da entrega' },
  { chave: 'proatividade', label: 'Proatividade (trouxe dúvidas, sugestões?)' },
  { chave: 'comunicacao', label: 'Comunicação com o tutor durante a missão' },
];
// Dificuldade ALTA = nota BAIXA (foi difícil pra ele) — exceto "prazo",
// "qualidade" e "proatividade", que já são medidos como qualidade (quanto
// melhor, maior a nota), não como dificuldade.
const CRITERIOS_INVERTIDOS = new Set(['entendimento', 'execucao', 'escrita', 'pesquisa', 'autonomia']);
const ESCALA_DIFICULDADE = { baixa: 10, razoavel: 7, alta: 4, altissima: 1, ignorado: null };
const ESCALA_QUALIDADE = { baixa: 1, razoavel: 4, alta: 7, altissima: 10, ignorado: null };

function calcularNotaFinal(respostas) {
  const notas = [];
  CRITERIOS_AVALIACAO.forEach((c) => {
    const resp = respostas[c.chave];
    if (!resp || resp === 'ignorado') return;
    const escala = CRITERIOS_INVERTIDOS.has(c.chave) ? ESCALA_DIFICULDADE : ESCALA_QUALIDADE;
    const nota = escala[resp];
    if (nota != null) notas.push(nota);
  });
  if (!notas.length) return null;
  return Math.round((notas.reduce((s, n) => s + n, 0) / notas.length) * 10) / 10;
}

function podeVerDelegacao(user, d) {
  if (isMaster(user) || isSocio(user)) return true;
  if (isEstagiario(user)) return (d.estagiarioIds || []).includes(user.id);
  // Associado: só se ele foi quem delegou, ou é um dos tutores da missão
  return d.criadoPor === user.id || (d.tutoresIds || []).includes(user.id);
}

router.get('/', requireAuth, async (req, res) => {
  if (req.user.tipo === 'cliente') return res.status(403).json({ erro: 'Sem acesso.' });
  const todas = await getCollection('delegacoes', []);
  res.json(todas.filter((d) => podeVerDelegacao(req.user, d)));
});

router.post('/', requireAuth, async (req, res) => {
  if (!isMaster(req.user) && !isSocio(req.user) && !isAssociado(req.user)) {
    return res.status(403).json({ erro: 'Só sócio, associado ou administrador podem delegar missões.' });
  }
  const { titulo, descricao, clienteId, processoId, estagiarioIds, prazoData, prazoHora, remuneracaoTipo, remuneracaoValor } = req.body || {};
  if (!titulo || !Array.isArray(estagiarioIds) || !estagiarioIds.length) {
    return res.status(400).json({ erro: 'Informe o título da missão e ao menos um estagiário.' });
  }
  const usuarios = await getCollection('usuarios', []);
  const idsEstagiariosValidos = estagiarioIds.filter((id) => usuarios.some((u) => u.id === id && u.tipo === 'estagiario'));
  if (!idsEstagiariosValidos.length) return res.status(400).json({ erro: 'Nenhum estagiário válido informado.' });

  const nova = {
    id: uid(),
    titulo,
    descricao: descricao || '',
    clienteId: clienteId || null,
    processoId: processoId || null,
    estagiarioIds: idsEstagiariosValidos,
    tutoresIds: [req.user.id],
    criadoPor: req.user.id,
    prazoData: prazoData || null,
    prazoHora: prazoHora || null,
    status: 'pendente', // pendente | entregue | concluida | nao_cumprida
    apontamentos: [],
    arquivos: [],
    avaliacao: null,
    remuneracaoTipo: ['valor', 'percentual'].includes(remuneracaoTipo) ? remuneracaoTipo : null,
    remuneracaoValor: remuneracaoValor ? parseFloat(remuneracaoValor) : null,
    criadoEm: new Date().toISOString(),
  };
  const todas = await getCollection('delegacoes', []);
  todas.push(nova);
  await setCollection('delegacoes', todas);

  // Denormaliza no processo (se houver) quais estagiários estão vinculados a
  // ele, pra visibilidade de Processos/Prazos do estagiário funcionar sem
  // precisar reconsultar delegações toda vez.
  if (processoId) {
    const processos = await getCollection('processos', []);
    const proc = processos.find((p) => p.id === processoId);
    if (proc) {
      proc.estagiariosVinculados = Array.from(new Set([...(proc.estagiariosVinculados || []), ...idsEstagiariosValidos]));
      await setCollection('processos', processos);
    }
  }
  res.status(201).json(nova);
});

router.post('/:id/apontamento', requireAuth, async (req, res) => {
  const todas = await getCollection('delegacoes', []);
  const d = todas.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ erro: 'Missão não encontrada.' });
  if (!podeVerDelegacao(req.user, d)) return res.status(403).json({ erro: 'Sem acesso a esta missão.' });
  const { texto } = req.body || {};
  if (!texto || !texto.trim()) return res.status(400).json({ erro: 'Escreva o apontamento.' });
  d.apontamentos.push({ id: uid(), autorId: req.user.id, texto: texto.trim(), data: new Date().toISOString() });
  await setCollection('delegacoes', todas);
  res.status(201).json(d);
});

// Só sócio ou master podem apagar um apontamento (o estagiário e o
// associado/tutor não podem apagar a própria fala nem a de terceiros).
router.delete('/:id/apontamento/:apontId', requireAuth, async (req, res) => {
  if (!isMaster(req.user) && !isSocio(req.user)) return res.status(403).json({ erro: 'Só sócio ou administrador podem apagar apontamentos.' });
  const todas = await getCollection('delegacoes', []);
  const d = todas.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ erro: 'Missão não encontrada.' });
  d.apontamentos = d.apontamentos.filter((a) => a.id !== req.params.apontId);
  await setCollection('delegacoes', todas);
  res.json(d);
});

// Upload do arquivo produzido — guardado em base64 dentro do próprio
// documento (arquivo pensado para ser baixado e depois apagado, não é
// armazenamento de longo prazo).
router.post('/:id/arquivo', requireAuth, async (req, res) => {
  const todas = await getCollection('delegacoes', []);
  const d = todas.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ erro: 'Missão não encontrada.' });
  if (!podeVerDelegacao(req.user, d)) return res.status(403).json({ erro: 'Sem acesso a esta missão.' });
  const { nomeArquivo, conteudoBase64 } = req.body || {};
  if (!nomeArquivo || !conteudoBase64) return res.status(400).json({ erro: 'Arquivo inválido.' });
  if (conteudoBase64.length > 14 * 1024 * 1024) return res.status(413).json({ erro: 'Arquivo muito grande (máximo ~10MB).' });
  d.arquivos.push({ id: uid(), nome: nomeArquivo, conteudoBase64, enviadoPor: req.user.id, enviadoEm: new Date().toISOString() });
  if (d.status === 'pendente') d.status = 'entregue';
  await setCollection('delegacoes', todas);
  res.status(201).json(d);
});

router.get('/:id/arquivo/:arquivoId', requireAuth, async (req, res) => {
  const todas = await getCollection('delegacoes', []);
  const d = todas.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ erro: 'Missão não encontrada.' });
  if (!podeVerDelegacao(req.user, d)) return res.status(403).json({ erro: 'Sem acesso a esta missão.' });
  const arq = d.arquivos.find((a) => a.id === req.params.arquivoId);
  if (!arq) return res.status(404).json({ erro: 'Arquivo não encontrado.' });
  res.json(arq);
});

// Apaga o arquivo — pensado para ser usado depois que o tutor já baixou e
// marcou a missão como cumprida/não cumprida.
router.delete('/:id/arquivo/:arquivoId', requireAuth, async (req, res) => {
  const todas = await getCollection('delegacoes', []);
  const d = todas.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ erro: 'Missão não encontrada.' });
  if (!podeVerDelegacao(req.user, d)) return res.status(403).json({ erro: 'Sem acesso a esta missão.' });
  d.arquivos = d.arquivos.filter((a) => a.id !== req.params.arquivoId);
  await setCollection('delegacoes', todas);
  res.json(d);
});

// Permite delegar a missão a mais um tutor/responsável (ex: um segundo
// sócio/associado acompanhando o mesmo estagiário).
router.patch('/:id/tutores', requireAuth, async (req, res) => {
  if (!isMaster(req.user) && !isSocio(req.user)) return res.status(403).json({ erro: 'Sem permissão.' });
  const { tutoresIds } = req.body || {};
  if (!Array.isArray(tutoresIds)) return res.status(400).json({ erro: 'Lista de tutores inválida.' });
  const todas = await getCollection('delegacoes', []);
  const d = todas.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ erro: 'Missão não encontrada.' });
  d.tutoresIds = tutoresIds;
  await setCollection('delegacoes', todas);
  res.json(d);
});

// O coração do sistema de pontuação: o tutor marca a missão como cumprida ou
// não cumprida, preenchendo os 10 critérios — a nota final (0 a 10) é
// calculada automaticamente pela média dos critérios respondidos (os
// marcados como "ignorado" não entram na média).
router.patch('/:id/avaliar', requireAuth, async (req, res) => {
  if (!isMaster(req.user) && !isSocio(req.user) && !isAssociado(req.user)) {
    return res.status(403).json({ erro: 'Só quem delegou/tutor pode avaliar a missão.' });
  }
  const { cumprida, respostas, observacao } = req.body || {};
  if (typeof cumprida !== 'boolean') return res.status(400).json({ erro: 'Informe se a missão foi cumprida.' });
  const todas = await getCollection('delegacoes', []);
  const d = todas.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ erro: 'Missão não encontrada.' });
  if (!podeVerDelegacao(req.user, d)) return res.status(403).json({ erro: 'Sem acesso a esta missão.' });
  const notaFinal = calcularNotaFinal(respostas || {});
  d.status = cumprida ? 'concluida' : 'nao_cumprida';
  d.avaliacao = {
    cumprida, respostas: respostas || {}, notaFinal, observacao: observacao || '',
    avaliadoPor: req.user.id, avaliadoEm: new Date().toISOString(),
  };
  await setCollection('delegacoes', todas);
  res.json(d);
});

router.get('/criterios', requireAuth, (req, res) => {
  res.json({ criterios: CRITERIOS_AVALIACAO, criteriosInvertidos: Array.from(CRITERIOS_INVERTIDOS) });
});

module.exports = router;
