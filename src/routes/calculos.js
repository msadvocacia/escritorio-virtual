const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { calcularCorrecao, mesesEntre } = require('../utils/correcaoMonetaria');
const { calcularSalarioBeneficio, calcularRMIRegraPermanente } = require('../utils/calculoPrevidenciario');
const { obterParametrosCalculo, salvarParametrosCalculo } = require('../utils/parametrosCalculo');
const { calcularRetroativoPccr } = require('../utils/calculoRetroativoPccr');
const multer = require('multer');
const { extrairTextoPdf, extrairTabelasPdf, linhasDeTextoTabulado, pdfPareceEscaneado, parseFichaFinanceiraDeTabelas, parseTabelaNiveis, parseTabelaNiveisDeTabelas, parseContrachequeDeTabelas } = require('../utils/leituraFichaFinanceira');

// Tenta a extração por tabela detectada primeiro (mais confiável quando o PDF
// tem linhas de grade); se nenhuma tabela for reconhecida (comum em recibos
// simples, sem bordas explícitas), cai para o texto separado por tabulações.
async function obterLinhasParaLeitura(buffer, texto) {
  const porTabela = await extrairTabelasPdf(buffer);
  if (porTabela.length) return porTabela;
  return linhasDeTextoTabulado(texto);
}

// Upload em memória — o arquivo nunca toca o disco nem o banco de dados;
// existe só durante o processamento desta requisição.
const uploadPdf = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const { calcularRescisao } = require('../utils/calculoTrabalhista');

const router = express.Router();

// Todos os módulos de cálculo são de uso interno da equipe (não faz sentido
// para o cliente), então restringimos a master/sócio/associado.
router.use(requireAuth, requireRole('master', 'socio', 'associado'));

// Núcleo: correção monetária + juros — usado isoladamente ou por outros módulos.
router.post('/correcao', async (req, res) => {
  const { valorBase, dataInicial, dataFinal, indice, juros } = req.body || {};
  if (!valorBase || !dataInicial || !dataFinal || !indice) {
    return res.status(400).json({ erro: 'Preencha valor, datas e índice.' });
  }
  try {
    const resultado = await calcularCorrecao(parseFloat(valorBase), dataInicial, dataFinal, indice, juros || { tipo: 'nenhum' });
    res.json(resultado);
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível calcular a correção.' });
  }
});

// Trabalhista: verbas rescisórias (dispensa sem justa causa)
router.post('/trabalhista/rescisao', async (req, res) => {
  const { salario, dataAdmissao, dataDemissao, avisoPrevioIndenizado, saldoFgtsInformado } = req.body || {};
  if (!salario || !dataAdmissao || !dataDemissao) {
    return res.status(400).json({ erro: 'Preencha salário e as datas de admissão/demissão.' });
  }
  try {
    const resultado = calcularRescisao({
      salario: parseFloat(salario), dataAdmissao, dataDemissao,
      avisoPrevioIndenizado: !!avisoPrevioIndenizado,
      saldoFgtsInformado: saldoFgtsInformado ? parseFloat(saldoFgtsInformado) : null,
    });
    res.json(resultado);
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível calcular a rescisão.' });
  }
});

// Cível: repetição de indébito (simples ou em dobro, art. 42 CDC), com correção opcional
router.post('/civel/indebito', async (req, res) => {
  const { valorPago, emDobro, aplicarCorrecao, dataInicial, dataFinal, indice } = req.body || {};
  if (!valorPago) return res.status(400).json({ erro: 'Informe o valor pago indevidamente.' });
  const valorBase = parseFloat(valorPago) * (emDobro ? 2 : 1);
  if (!aplicarCorrecao) {
    return res.json({ valorBase, valorFinal: valorBase, fatorCorrecao: 1, valorJuros: 0 });
  }
  if (!dataInicial || !dataFinal || !indice) {
    return res.status(400).json({ erro: 'Para aplicar correção, informe as datas e o índice.' });
  }
  try {
    const resultado = await calcularCorrecao(valorBase, dataInicial, dataFinal, indice, { tipo: 'nenhum' });
    res.json(resultado);
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível calcular a correção.' });
  }
});

// Tributário: multa + juros SELIC sobre tributo em atraso
router.post('/tributario/multa-juros', async (req, res) => {
  const { valorTributo, dataVencimento, dataPagamento, percentualMulta } = req.body || {};
  if (!valorTributo || !dataVencimento || !dataPagamento) {
    return res.status(400).json({ erro: 'Preencha o valor do tributo e as duas datas.' });
  }
  try {
    const multa = parseFloat(valorTributo) * ((parseFloat(percentualMulta) || 20) / 100);
    const baseComMulta = parseFloat(valorTributo) + multa;
    const resultado = await calcularCorrecao(baseComMulta, dataVencimento, dataPagamento, 'SELIC', { tipo: 'nenhum' });
    res.json({ ...resultado, multa, valorTributo: parseFloat(valorTributo) });
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível calcular.' });
  }
});

// Execução Fiscal: atualização de débito inscrito em dívida ativa (mesma lógica: Selic acumulada)
router.post('/execucao-fiscal/atualizacao', async (req, res) => {
  const { valorInscrito, dataInscricao, dataAtualizacao } = req.body || {};
  if (!valorInscrito || !dataInscricao || !dataAtualizacao) {
    return res.status(400).json({ erro: 'Preencha o valor inscrito e as duas datas.' });
  }
  try {
    const resultado = await calcularCorrecao(parseFloat(valorInscrito), dataInscricao, dataAtualizacao, 'SELIC', { tipo: 'nenhum' });
    res.json(resultado);
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível calcular.' });
  }
});

// Locação: revisional de aluguel (reajuste pelo índice) e débitos locatícios (correção + multa contratual)
router.post('/locacao/reajuste', async (req, res) => {
  const { valorAluguel, dataUltimoReajuste, dataNova, indice } = req.body || {};
  if (!valorAluguel || !dataUltimoReajuste || !dataNova || !indice) {
    return res.status(400).json({ erro: 'Preencha valor, datas e índice.' });
  }
  try {
    const resultado = await calcularCorrecao(parseFloat(valorAluguel), dataUltimoReajuste, dataNova, indice, { tipo: 'nenhum' });
    res.json(resultado);
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível calcular.' });
  }
});
router.post('/locacao/debitos', async (req, res) => {
  const { valorDebito, percentualMulta, dataVencimento, dataPagamento, indice } = req.body || {};
  if (!valorDebito || !dataVencimento || !dataPagamento || !indice) {
    return res.status(400).json({ erro: 'Preencha valor, datas e índice.' });
  }
  try {
    const multa = parseFloat(valorDebito) * ((parseFloat(percentualMulta) || 0) / 100);
    const resultado = await calcularCorrecao(parseFloat(valorDebito) + multa, dataVencimento, dataPagamento, indice, { tipo: 'nenhum' });
    res.json({ ...resultado, multa });
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível calcular.' });
  }
});

// Seguros: DPVAT/SPVAT — valores tabelados fixos por lei (não sujeitos a índice)
router.post('/seguros/dpvat', async (req, res) => {
  const { tipo, percentualInvalidez } = req.body || {};
  const TETO_MORTE = 13500;
  const TETO_INVALIDEZ = 13500;
  const TETO_DAMS = 2700;
  let valor = 0;
  if (tipo === 'morte') valor = TETO_MORTE;
  else if (tipo === 'invalidez') valor = TETO_INVALIDEZ * ((parseFloat(percentualInvalidez) || 100) / 100);
  else if (tipo === 'dams') valor = TETO_DAMS;
  else return res.status(400).json({ erro: 'Selecione o tipo de indenização.' });
  res.json({ valor, tipo });
});

// Família: partilha de bens (divide um conjunto de bens/dívidas entre 2 partes)
router.post('/familia/partilha', async (req, res) => {
  const { bens } = req.body || {}; // [{ descricao, valor, partilhavel }]
  if (!Array.isArray(bens) || !bens.length) return res.status(400).json({ erro: 'Informe ao menos um bem.' });
  const totalBens = bens.filter((b) => b.partilhavel !== false).reduce((s, b) => s + (parseFloat(b.valor) || 0), 0);
  const meacao = totalBens / 2;
  res.json({ totalBens, meacaoParteA: meacao, meacaoParteB: meacao, itens: bens });
});

// Penal: dosimetria da pena (3 fases, art. 68 CP)
router.post('/penal/dosimetria', async (req, res) => {
  const { penaMinimaMeses, penaMaximaMeses, fracaoCircunstanciasJudiciais, fracaoAgravantes, fracaoAtenuantes, fracaoAumento, fracaoDiminuicao } = req.body || {};
  if (penaMinimaMeses == null || penaMaximaMeses == null) return res.status(400).json({ erro: 'Informe a pena mínima e máxima em meses.' });
  const min = parseFloat(penaMinimaMeses), max = parseFloat(penaMaximaMeses);
  const intervalo = max - min;

  // 1ª fase: pena-base, dentro do intervalo, conforme fração das circunstâncias judiciais (art. 59)
  const penaBase = min + intervalo * ((parseFloat(fracaoCircunstanciasJudiciais) || 0) / 100);
  // 2ª fase: agravantes/atenuantes (não pode reduzir abaixo do mínimo nem elevar acima do máximo)
  let penaFase2 = penaBase * (1 + ((parseFloat(fracaoAgravantes) || 0) / 100)) * (1 - ((parseFloat(fracaoAtenuantes) || 0) / 100));
  penaFase2 = Math.min(Math.max(penaFase2, min), max);
  // 3ª fase: causas de aumento/diminuição (aqui SIM pode ultrapassar min/max)
  const penaFinal = penaFase2 * (1 + ((parseFloat(fracaoAumento) || 0) / 100)) * (1 - ((parseFloat(fracaoDiminuicao) || 0) / 100));

  res.json({ penaBase, penaFase2, penaFinal, penaFinalAnos: penaFinal / 12 });
});

// Desapropriação: indenização + juros compensatórios (12% a.a. — Súmula 618 STF) e moratórios
router.post('/desapropriacao/indenizacao', async (req, res) => {
  const { valorJusto, dataImissaoPosse, dataPagamento, taxaJurosCompensatoriosAnual, taxaJurosMoratoriosAoMes, indice } = req.body || {};
  if (!valorJusto || !dataImissaoPosse || !dataPagamento || !indice) {
    return res.status(400).json({ erro: 'Preencha o valor justo, as datas e o índice.' });
  }
  try {
    const correcao = await calcularCorrecao(parseFloat(valorJusto), dataImissaoPosse, dataPagamento, indice, { tipo: 'nenhum' });
    const anos = Math.max((new Date(dataPagamento) - new Date(dataImissaoPosse)) / (365.25 * 86400000), 0);
    const taxaCompAnual = (parseFloat(taxaJurosCompensatoriosAnual) || 12) / 100;
    const jurosCompensatorios = correcao.valorCorrigido * taxaCompAnual * anos;
    let jurosMoratorios = 0;
    if (taxaJurosMoratoriosAoMes) {
      const meses = Math.max(mesesEntre(dataImissaoPosse, dataPagamento), 0);
      jurosMoratorios = correcao.valorCorrigido * ((parseFloat(taxaJurosMoratoriosAoMes) || 0) / 100) * meses;
    }
    res.json({
      valorJusto: parseFloat(valorJusto), valorCorrigido: correcao.valorCorrigido, fatorCorrecao: correcao.fatorCorrecao,
      jurosCompensatorios, jurosMoratorios, valorFinal: correcao.valorCorrigido + jurosCompensatorios + jurosMoratorios,
    });
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível calcular.' });
  }
});

// FGTS (bloco próprio): diferenças de FGTS não recolhido (8% ao mês sobre a remuneração), corrigidas
router.post('/fgts/diferencas', async (req, res) => {
  const { remuneracaoMensal, mesesNaoRecolhidos, dataInicial, dataFinal, indice } = req.body || {};
  if (!remuneracaoMensal || !mesesNaoRecolhidos || !dataInicial || !dataFinal || !indice) {
    return res.status(400).json({ erro: 'Preencha remuneração, quantidade de meses e as datas.' });
  }
  try {
    const valorNaoRecolhido = parseFloat(remuneracaoMensal) * 0.08 * parseFloat(mesesNaoRecolhidos);
    const resultado = await calcularCorrecao(valorNaoRecolhido, dataInicial, dataFinal, indice, { tipo: 'nenhum' });
    res.json({ ...resultado, valorNaoRecolhido });
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível calcular.' });
  }
});

// Previdenciário — ESCOPO LIMITADO DE PROPÓSITO: só a regra permanente (EC 103/2019).
// Não cobre fator previdenciário, regras de transição por pontos/pedágio,
// divisor mínimo ou aposentadoria especial/invalidez. Ver aviso na tela.
router.post('/previdenciario/salario-beneficio', async (req, res) => {
  const { salarios, dataCalculo } = req.body || {};
  if (!dataCalculo) return res.status(400).json({ erro: 'Informe a data de início do benefício (DIB).' });
  try {
    const resultado = await calcularSalarioBeneficio(salarios, dataCalculo);
    res.json(resultado);
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível calcular o salário de benefício.' });
  }
});
router.post('/previdenciario/rmi', async (req, res) => {
  const { salarioBeneficio, anosContribuicao, anosMinimoExigido } = req.body || {};
  if (!salarioBeneficio || anosContribuicao == null || !anosMinimoExigido) {
    return res.status(400).json({ erro: 'Preencha o salário de benefício, os anos de contribuição e o tempo mínimo exigido.' });
  }
  try {
    const resultado = await calcularRMIRegraPermanente(parseFloat(salarioBeneficio), parseFloat(anosContribuicao), parseFloat(anosMinimoExigido));
    res.json(resultado);
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível calcular a RMI.' });
  }
});

// Empresarial: distribuição de lucros/dividendos proporcional à participação societária
router.post('/empresarial/distribuicao-lucros', async (req, res) => {
  const { lucroTotal, socios } = req.body || {}; // socios: [{ nome, percentual }]
  if (!lucroTotal || !Array.isArray(socios) || !socios.length) {
    return res.status(400).json({ erro: 'Informe o lucro total e ao menos um sócio.' });
  }
  const somaPercentuais = socios.reduce((s, x) => s + (parseFloat(x.percentual) || 0), 0);
  if (Math.abs(somaPercentuais - 100) > 0.01) {
    return res.status(400).json({ erro: `Os percentuais somam ${somaPercentuais}%, mas deveriam somar 100%.` });
  }
  const distribuicao = socios.map((s) => ({ nome: s.nome, percentual: parseFloat(s.percentual), valor: parseFloat(lucroTotal) * (parseFloat(s.percentual) / 100) }));
  res.json({ lucroTotal: parseFloat(lucroTotal), distribuicao });
});

// Consumidor/Bancário: comparação de sistemas de amortização Price vs SAC
router.post('/consumidor/amortizacao', async (req, res) => {
  const { valorFinanciado, taxaJurosAoMes, numeroParcelas } = req.body || {};
  if (!valorFinanciado || !taxaJurosAoMes || !numeroParcelas) {
    return res.status(400).json({ erro: 'Preencha valor financiado, taxa de juros e número de parcelas.' });
  }
  const PV = parseFloat(valorFinanciado);
  const i = parseFloat(taxaJurosAoMes) / 100;
  const n = parseInt(numeroParcelas, 10);

  // Tabela Price: parcela fixa
  const parcelaPrice = i === 0 ? PV / n : (PV * i) / (1 - Math.pow(1 + i, -n));
  const totalPagoPrice = parcelaPrice * n;
  const parcelasPrice = [];
  let saldoPrice = PV;
  for (let k = 1; k <= n; k++) {
    const jurosMes = saldoPrice * i;
    const amortizacaoMes = parcelaPrice - jurosMes;
    saldoPrice -= amortizacaoMes;
    parcelasPrice.push({ parcela: k, valor: parcelaPrice, juros: jurosMes, amortizacao: amortizacaoMes, saldoDevedor: Math.max(saldoPrice, 0) });
  }

  // SAC: amortização constante, parcela decrescente
  const amortizacaoConstante = PV / n;
  const parcelasSac = [];
  let saldoSac = PV;
  for (let k = 1; k <= n; k++) {
    const jurosMes = saldoSac * i;
    const valorParcela = amortizacaoConstante + jurosMes;
    saldoSac -= amortizacaoConstante;
    parcelasSac.push({ parcela: k, valor: valorParcela, juros: jurosMes, amortizacao: amortizacaoConstante, saldoDevedor: Math.max(saldoSac, 0) });
  }
  const totalPagoSac = parcelasSac.reduce((s, p) => s + p.valor, 0);

  res.json({
    price: { primeiraParcela: parcelasPrice[0].valor, ultimaParcela: parcelasPrice[n - 1].valor, totalPago: totalPagoPrice, totalJuros: totalPagoPrice - PV, parcelas: parcelasPrice },
    sac: { primeiraParcela: parcelasSac[0].valor, ultimaParcela: parcelasSac[n - 1].valor, totalPago: totalPagoSac, totalJuros: totalPagoSac - PV, parcelas: parcelasSac },
  });
});

// Parâmetros de cálculo (teto/piso INSS, percentuais de planos econômicos) —
// editáveis por master/sócio, para não depender de redeploy quando uma nova
// portaria/lei mudar esses valores.
router.get('/parametros', async (req, res) => {
  res.json(await obterParametrosCalculo());
});
router.put('/parametros', requireRole('master', 'socio'), async (req, res) => {
  try {
    const atualizado = await salvarParametrosCalculo(req.body || {});
    res.json(atualizado);
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível salvar os parâmetros.' });
  }
});

// Administrativo / Servidor Público — reposição salarial (índice) e diferenças
// de planos econômicos (percentuais fixados em jurisprudência consolidada).
// NÃO cobre quintos/décimos incorporados nem VPNI — isso varia muito por ente
// federativo/tribunal e exige análise específica do caso.
router.post('/administrativo/reposicao', async (req, res) => {
  const { valorBase, dataInicial, dataFinal, indice } = req.body || {};
  if (!valorBase || !dataInicial || !dataFinal || !indice) {
    return res.status(400).json({ erro: 'Preencha valor, datas e índice.' });
  }
  try {
    const resultado = await calcularCorrecao(parseFloat(valorBase), dataInicial, dataFinal, indice, { tipo: 'nenhum' });
    res.json(resultado);
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível calcular.' });
  }
});
router.post('/administrativo/planos-economicos', async (req, res) => {
  const { valorBase, chavesPlanos } = req.body || {};
  if (!valorBase || !Array.isArray(chavesPlanos) || !chavesPlanos.length) {
    return res.status(400).json({ erro: 'Informe o valor base e ao menos um plano econômico.' });
  }
  const { planosEconomicos } = await obterParametrosCalculo();
  const selecionados = planosEconomicos.filter((p) => chavesPlanos.includes(p.chave));
  if (!selecionados.length) return res.status(400).json({ erro: 'Planos selecionados não encontrados.' });
  let fator = 1;
  selecionados.forEach((p) => { fator *= (1 + p.percentual / 100); });
  const valorComDiferenca = parseFloat(valorBase) * fator;
  res.json({ valorBase: parseFloat(valorBase), planosAplicados: selecionados, fator, diferenca: valorComDiferenca - parseFloat(valorBase), valorFinal: valorComDiferenca });
});

// Retroativos PCCR (mudança de nível / implantação de gratificação)
router.post('/retroativo-pccr', async (req, res) => {
  try {
    const resultado = await calcularRetroativoPccr(req.body || {});
    res.json(resultado);
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível calcular.' });
  }
});

// Importação de PDF da ficha financeira — processado só em memória, nunca
// salvo em disco ou no banco. Devolve uma lista de meses PRÉ-PREENCHIDA, para
// revisão manual antes de calcular (nunca calcula direto do PDF).
router.post('/retroativo-pccr/importar-ficha', uploadPdf.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Envie um arquivo PDF.' });
  try {
    const texto = await extrairTextoPdf(req.file.buffer);
    if (pdfPareceEscaneado(texto)) {
      return res.status(422).json({
        erro: 'Este PDF parece ser escaneado (imagem, sem texto por trás) — não é possível ler automaticamente neste servidor. Use uma exportação em PDF gerada direto pelo sistema de folha (com texto selecionável), ou preencha os meses manualmente.',
      });
    }
    const meses = parseFichaFinanceiraDeTabelas(await obterLinhasParaLeitura(req.file.buffer, texto));
    if (!meses.length) {
      return res.status(422).json({ erro: 'Não consegui reconhecer o formato desta ficha financeira. Preencha os meses manualmente, ou peça para eu ajustar a leitura para o formato do seu sistema.' });
    }
    res.json({ meses, aviso: 'Confira e corrija os valores abaixo antes de calcular — a leitura automática é um ponto de partida, não um resultado final.' });
  } catch (e) {
    res.status(400).json({ erro: 'Não foi possível ler este PDF: ' + (e.message || 'erro desconhecido.') });
  }
});

// Importação de PDF da tabela de níveis/categorias do PCS — mesma lógica de
// só-em-memória, com revisão manual antes de usar.
router.post('/retroativo-pccr/importar-tabela-niveis', uploadPdf.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Envie um arquivo PDF.' });
  try {
    const texto = await extrairTextoPdf(req.file.buffer);
    if (pdfPareceEscaneado(texto)) {
      return res.status(422).json({
        erro: 'Este PDF parece ser escaneado (imagem, sem texto por trás) — não é possível ler automaticamente neste servidor. Use uma exportação em PDF com texto selecionável, ou preencha os níveis manualmente.',
      });
    }
    let niveis = parseTabelaNiveisDeTabelas(await obterLinhasParaLeitura(req.file.buffer, texto));
    if (!niveis.length) niveis = parseTabelaNiveis(texto); // fallback: texto corrido, sem tabela estruturada
    if (!niveis.length) {
      return res.status(422).json({ erro: 'Não consegui reconhecer níveis e valores neste PDF. Preencha manualmente, ou peça para eu ajustar a leitura para o formato da sua tabela.' });
    }
    const reconhecidos = niveis.filter((n) => n.subgrupo && n.nivel && n.classe).length;
    res.json({
      niveis,
      aviso: reconhecidos === niveis.length
        ? 'Confira os valores antes de usar no cálculo.'
        : `Consegui identificar subgrupo/nível/classe em ${reconhecidos} de ${niveis.length} linha(s) — as demais aparecem só com o valor, sem essa separação. Confira tudo antes de usar.`,
    });
  } catch (e) {
    res.status(400).json({ erro: 'Não foi possível ler este PDF: ' + (e.message || 'erro desconhecido.') });
  }
});

// Importação de UM contracheque (mês único) — usado para estimar rapidamente
// um período inteiro a partir de só 2 contracheques (o último mês sem o
// benefício, e o primeiro mês já com o benefício implantado). Processado só
// em memória, nunca salvo em disco ou no banco.
router.post('/retroativo-pccr/importar-contracheque', uploadPdf.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Envie um arquivo PDF.' });
  try {
    const texto = await extrairTextoPdf(req.file.buffer);
    if (pdfPareceEscaneado(texto)) {
      return res.status(422).json({
        erro: 'Este PDF parece ser escaneado (imagem, sem texto por trás) — não é possível ler automaticamente neste servidor. Use uma exportação em PDF com texto selecionável, ou preencha manualmente.',
      });
    }
    const dados = parseContrachequeDeTabelas(await obterLinhasParaLeitura(req.file.buffer, texto));
    if (dados.basePago == null) {
      return res.status(422).json({ erro: 'Não consegui identificar o salário-base neste contracheque. Preencha manualmente, ou peça para eu ajustar a leitura para o formato do seu documento.' });
    }
    res.json({ dados, aviso: 'Confira os valores antes de usar — a leitura automática é um ponto de partida.' });
  } catch (e) {
    res.status(400).json({ erro: 'Não foi possível ler este PDF: ' + (e.message || 'erro desconhecido.') });
  }
});

module.exports = router;
