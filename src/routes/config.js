const express = require('express');
const { getCollection, setCollection } = require('../utils/store');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const DEFAULT_CONFIG = {
  instagram: 'https://instagram.com/msadvocacia.073',
  endereco: 'Rua Frederico Costa, 124, Centro, Jequié, Bahia, CEP 45200-225',
  telefone: '(73) 99194-3622',
  email: 'msadvocacia.073@gmail.com',
};

// Público — a página inicial precisa disso sem estar logado.
router.get('/', async (req, res) => {
  const config = await getCollection('config', null);
  res.json(config && Object.keys(config).length ? config : DEFAULT_CONFIG);
});

router.put('/', requireAuth, requireRole('master', 'socio'), async (req, res) => {
  const atual = await getCollection('config', DEFAULT_CONFIG);
  const novo = { ...atual, ...req.body };
  await setCollection('config', novo);
  res.json(novo);
});

module.exports = router;
