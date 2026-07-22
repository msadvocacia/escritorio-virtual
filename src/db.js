const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('ERRO: variável de ambiente MONGODB_URI não definida. Configure o arquivo .env (veja .env.example).');
    process.exit(1);
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log('Conectado ao MongoDB.');
}

module.exports = { connectDB };
