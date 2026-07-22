const mongoose = require('mongoose');

/*
  Cada "coleção" do sistema (usuarios, clientes, processos, prazos, honorarios,
  despesas, lembretes, disponibilidades, agendamentos, mensagens, audiencias, config)
  fica guardada como UM documento nesta coleção do Mongo, com o campo `data` contendo
  o array (ou objeto, no caso de "config") correspondente.

  Essa escolha é deliberada: o sistema já existia como um protótipo (artifact) que
  guardava cada coleção como um array em uma chave de armazenamento. Replicar esse
  mesmo formato no MongoDB permite reaproveitar quase todo o código de tela (telas,
  formulários, cálculos) sem reescrever a aplicação inteira do zero.

  Limitação conhecida (documentada para você): como cada coleção é "um documento só",
  duas pessoas salvando a MESMA coleção ao mesmo tempo podem, em teoria, sobrescrever
  uma a outra (a política de mesclagem por dono, em src/utils/merge.js, reduz bastante
  esse risco, mas não elimina 100%). Para um escritório pequeno isso tende a não ser
  um problema na prática. Se um dia o volume de uso crescer muito, o próximo passo
  natural é migrar cada tipo de registro para sua própria coleção normalizada.
*/
const dataCollectionSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, index: true },
  data: { type: mongoose.Schema.Types.Mixed, default: [] },
  updatedAt: { type: Date, default: Date.now },
});

dataCollectionSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('DataCollection', dataCollectionSchema);
