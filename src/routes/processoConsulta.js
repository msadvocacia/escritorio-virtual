const express = require('express');
const ProcessoConsulta = require('../models/ProcessoConsulta');
const { requireAuth } = require('../middleware/auth');
const { getCollection } = require('../utils/store');
const { isCliente } = require('../utils/visibility');
const { limparNumero } = require('../utils/cnj');
const { buscarUltimaMovimentacao } = require('../utils/datajud');
const { explicarParaLeigo } = require('../utils/gemini');

const router = express.Router();

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

router.post('/consulta', requireAuth, async (req, res) => {
  const { numeroCNJ } = req.body || {};
  if (!numeroCNJ) return res.status(400).json({ erro: 'Informe o número do processo.' });

  const digitos = limparNumero(numeroCNJ);

  // Se for cliente, só pode consultar processos que são dele mesmo (evita uso
  // indevido das chaves de API do escritório para consultar números de terceiros).
  if (isCliente(req.user)) {
    const processos = await getCollection('processos', []);
    const meuProcesso = processos.find(
      (p) => p.clienteId === req.user.clienteId && limparNumero(p.numero) === digitos
    );
    if (!meuProcesso) {
      return res.status(403).json({ erro: 'Você só pode consultar processos vinculados ao seu próprio cadastro.' });
    }
  }

  const diaConsulta = hojeISO();

  try {
    const existente = await ProcessoConsulta.findOne({ numeroCNJ: digitos, diaConsulta });
    if (existente) {
      return res.json({
        numeroCNJ: digitos,
        dataMovimento: existente.dataMovimento,
        textoOriginal: existente.textoOriginal,
        textoSimplificado: existente.textoSimplificado,
        avisoIA: existente.avisoIA,
        origem: 'cache',
      });
    }

    const movimento = await buscarUltimaMovimentacao(digitos);
    const { textoSimplificado, avisoIA } = await explicarParaLeigo(movimento.textoOriginal);

    await ProcessoConsulta.findOneAndUpdate(
      { numeroCNJ: digitos, diaConsulta },
      {
        $set: {
          dataMovimento: movimento.dataMovimento,
          textoOriginal: movimento.textoOriginal,
          textoSimplificado,
          avisoIA,
          atualizadoEm: new Date(),
        },
      },
      { upsert: true }
    );

    res.json({
      numeroCNJ: digitos,
      dataMovimento: movimento.dataMovimento,
      textoOriginal: movimento.textoOriginal,
      textoSimplificado,
      avisoIA,
      origem: 'consulta_ao_vivo',
    });
  } catch (e) {
    res.status(502).json({ erro: e.message || 'Não foi possível consultar a movimentação deste processo agora.' });
  }
});

module.exports = router;
