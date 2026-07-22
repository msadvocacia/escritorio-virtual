const mongoose = require('mongoose');

const processoConsultaSchema = new mongoose.Schema({
  numeroCNJ: { type: String, required: true, index: true },
  diaConsulta: { type: String, required: true }, // formato AAAA-MM-DD, para saber se já foi consultado hoje
  dataMovimento: { type: String, default: null },
  textoOriginal: { type: String, default: '' },
  textoSimplificado: { type: String, default: null },
  avisoIA: { type: String, default: null },
  atualizadoEm: { type: Date, default: Date.now },
});

processoConsultaSchema.index({ numeroCNJ: 1, diaConsulta: 1 }, { unique: true });

module.exports = mongoose.model('ProcessoConsulta', processoConsultaSchema);
