function onlyDigits(s) { return (s || '').replace(/\D/g, ''); }

function formatCPF(cpf) {
  const d = onlyDigits(cpf);
  if (d.length !== 11) return cpf || '—';
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function fmtDateExtenso(iso) {
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const [y, m, d] = iso.split('-');
  return `${parseInt(d, 10)} de ${meses[parseInt(m, 10) - 1]} de ${y}`;
}

function numToWordsGroupPT(n) {
  const units = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const teens = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const hundreds = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const h = Math.floor(n / 100), r = n % 100;
  const parts = [];
  if (h > 0) parts.push(hundreds[h]);
  if (r > 0) {
    if (r < 10) parts.push(units[r]);
    else if (r < 20) parts.push(teens[r - 10]);
    else { const t = Math.floor(r / 10), u = r % 10; parts.push(tens[t] + (u > 0 ? ' e ' + units[u] : '')); }
  }
  return parts.join(' e ');
}

function numberToWordsPT(n) {
  if (n === 0) return 'zero';
  const milhoes = Math.floor(n / 1000000), milhares = Math.floor((n % 1000000) / 1000), resto = n % 1000;
  const parts = [];
  if (milhoes > 0) parts.push(numToWordsGroupPT(milhoes) + (milhoes === 1 ? ' milhão' : ' milhões'));
  if (milhares > 0) parts.push(milhares === 1 ? 'mil' : numToWordsGroupPT(milhares) + ' mil');
  if (resto > 0) parts.push(numToWordsGroupPT(resto));
  return parts.join(' e ') || 'zero';
}

function valorPorExtenso(valor) {
  valor = Math.round((valor || 0) * 100) / 100;
  const inteiro = Math.floor(valor);
  const centavos = Math.round((valor - inteiro) * 100);
  let texto = numberToWordsPT(inteiro) + (inteiro === 1 ? ' real' : ' reais');
  if (centavos > 0) texto += ' e ' + numberToWordsPT(centavos) + (centavos === 1 ? ' centavo' : ' centavos');
  return texto;
}

function enderecoCompleto(c) {
  return [c.logradouro, c.numero, c.complemento, c.bairro, (c.cidade && c.uf) ? `${c.cidade}/${c.uf}` : '', c.cep ? `CEP ${c.cep}` : '']
    .filter(Boolean).join(', ');
}

function qualificacaoCliente(c) {
  return `${c.nacionalidade || 'brasileiro(a)'}, ${c.estadoCivil || ''}, ${c.profissao || ''}, portador do RG nº ${c.rg || '—'} SSP/BA inscrito no CPF sob nº ${formatCPF(c.cpf)}, residente e domiciliado na/no ${enderecoCompleto(c) || '—'}`;
}

function qualificacaoAdvogado(a, telefoneEscritorio) {
  return `${a.nacionalidade || 'brasileiro(a)'}, ${a.estadoCivil || ''}, advogado(a), OAB/BA ${a.oab || '—'}, portador(a) da cédula de identidade sob nº ${a.rg || '—'}, inscrito(a) no CPF nº ${formatCPF(a.cpf)}, com endereço profissional na Rua Frederico Costa, nº 124, Centro, CEP: 45.200-225, Jequié-BA, telefone ${telefoneEscritorio || '(73) 99194-3622'}`;
}

function fmtMoney(v) {
  v = Number(v) || 0;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

module.exports = {
  onlyDigits, formatCPF, fmtDateExtenso, numberToWordsPT, valorPorExtenso, enderecoCompleto,
  qualificacaoCliente, qualificacaoAdvogado, fmtMoney,
};
