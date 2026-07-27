require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const { connectDB } = require('./src/db');
const { getCollection, setCollection } = require('./src/utils/store');

const authRoutes = require('./src/routes/auth');
const usuariosRoutes = require('./src/routes/usuarios');
const clientesRoutes = require('./src/routes/clientes');
const collectionsRoutes = require('./src/routes/collections');
const configRoutes = require('./src/routes/config');
const publicRoutes = require('./src/routes/public');
const meRoutes = require('./src/routes/me');
const processoConsultaRoutes = require('./src/routes/processoConsulta');
const documentosRoutes = require('./src/routes/documentos');
const calculosRoutes = require('./src/routes/calculos');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/collections', collectionsRoutes);
app.use('/api/config', configRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/me', meRoutes);
app.use('/api/processos', processoConsultaRoutes);
app.use('/api/documentos', documentosRoutes);
app.use('/api/calculos', calculosRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve o frontend estático (pasta public/) — o mesmo painel, adaptado para falar com esta API.
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ erro: 'Rota não encontrada.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function seedInicial() {
  const usuarios = await getCollection('usuarios', []);
  if (usuarios.length === 0) {
    const senha = process.env.MASTER_SENHA_INICIAL || 'master123';
    const senhaHash = await bcrypt.hash(senha, 10);
    await setCollection('usuarios', [{
      id: uid(), tipo: 'master', nome: 'Administrador Master', login: 'master',
      senhaHash, mustChange: true, ativo: true, oab: '', vinculoId: null,
    }]);
    console.log(`Usuário master criado. Login: master · Senha inicial: ${senha}`);
  }
  const config = await getCollection('config', null);
  if (!config || Object.keys(config).length === 0) {
    await setCollection('config', {
      instagram: 'https://instagram.com/msadvocacia.073',
      endereco: 'Rua Frederico Costa, 124, Centro, Jequié, Bahia, CEP 45200-225',
      telefone: '(73) 99194-3622',
      email: 'msadvocacia.073@gmail.com',
    });
  }
}

const PORT = process.env.PORT || 3000;

connectDB()
  .then(seedInicial)
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
  })
  .catch((err) => {
    console.error('Falha ao iniciar o servidor:', err);
    process.exit(1);
  });
