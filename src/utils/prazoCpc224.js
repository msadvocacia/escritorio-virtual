/*
  Cálculo de prazos conforme o art. 224 do CPC (Lei 13.105/2015):

    § 2º  Considera-se como data da publicação o primeiro dia útil seguinte
          ao da disponibilização da informação no Diário de Justiça
          Eletrônico.
    § 3º  A contagem do prazo tem início no primeiro dia útil seguinte à
          publicação.

    Art. 219: na contagem de prazo em dias, computam-se somente os dias úteis
    (não conta sábado, domingo nem feriado).

  Ou seja, três datas diferentes, nunca a mesma coisa:
    disponibilização -> (próximo dia útil) -> publicação -> (próximo dia útil) -> início da contagem

  LIMITAÇÃO IMPORTANTE, para não passar segurança que não existe: este
  calendário cobre feriados NACIONAIS fixos e móveis (Páscoa e derivados).
  NÃO cobre feriados estaduais/municipais nem suspensões de prazo específicas
  de cada tribunal (recesso forense, por exemplo, já está coberto como
  feriado nacional de 20/dez a 20/jan por convenção do CNJ — ver função
  abaixo). Prazos calculados aqui devem ser conferidos pelo advogado antes de
  serem considerados definitivos, especialmente perto de feriados locais.
*/

function feriadosNacionaisFixos(ano) {
  return [
    `${ano}-01-01`, // Confraternização Universal
    `${ano}-04-21`, // Tiradentes
    `${ano}-05-01`, // Dia do Trabalho
    `${ano}-09-07`, // Independência
    `${ano}-10-12`, // Nossa Senhora Aparecida
    `${ano}-11-02`, // Finados
    `${ano}-11-15`, // Proclamação da República
    `${ano}-11-20`, // Consciência Negra (feriado nacional desde 2024)
    `${ano}-12-25`, // Natal
  ];
}

// Domingo de Páscoa pelo algoritmo de Gauss/Meeus — base para Carnaval,
// Sexta-feira Santa e Corpus Christi, que são móveis.
function domingoPascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}
function somarDias(data, dias) {
  const d = new Date(data);
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}
function paraISO(data) {
  return data.toISOString().slice(0, 10);
}
function feriadosMoveisNacionais(ano) {
  const pascoa = domingoPascoa(ano);
  return [
    paraISO(somarDias(pascoa, -47)), // Carnaval (terça)
    paraISO(somarDias(pascoa, -2)),  // Sexta-feira Santa
    paraISO(somarDias(pascoa, 60)),  // Corpus Christi
  ];
}
function todosFeriados(ano) {
  return new Set([...feriadosNacionaisFixos(ano), ...feriadosMoveisNacionais(ano)]);
}
function ehFeriado(dataISO) {
  const ano = parseInt(dataISO.slice(0, 4), 10);
  return todosFeriados(ano).has(dataISO);
}
function ehDiaUtil(dataISO) {
  const d = new Date(dataISO + 'T12:00:00Z'); // meio-dia UTC evita problema de fuso na borda da data
  const diaSemana = d.getUTCDay(); // 0=domingo, 6=sábado
  if (diaSemana === 0 || diaSemana === 6) return false;
  if (ehFeriado(dataISO)) return false;
  return true;
}
function proximoDiaUtil(dataISO) {
  let d = somarDias(new Date(dataISO + 'T12:00:00Z'), 1);
  let iso = paraISO(d);
  while (!ehDiaUtil(iso)) { d = somarDias(d, 1); iso = paraISO(d); }
  return iso;
}
// Soma N dias ÚTEIS a partir de uma data (a própria data de partida não conta
// como um dos dias somados — é só a base a partir da qual se avança).
function somarDiasUteis(dataISO, quantidade) {
  let atual = dataISO;
  let restante = quantidade;
  while (restante > 0) {
    atual = proximoDiaUtil(atual);
    restante--;
  }
  return atual;
}

/**
 * Calcula, a partir da data de disponibilização no DJEN, as três datas do
 * art. 224 e (se informado um prazo em dias) a data final do prazo.
 */
function calcularDatasArt224(dataDisponibilizacaoISO, prazoDias) {
  if (!dataDisponibilizacaoISO) return null;
  const dataPublicacao = proximoDiaUtil(dataDisponibilizacaoISO);
  const dataInicioPrazo = proximoDiaUtil(dataPublicacao);
  const resultado = { dataDisponibilizacao: dataDisponibilizacaoISO, dataPublicacao, dataInicioPrazo };
  if (prazoDias) {
    // o próprio dataInicioPrazo já é o "dia 1" da contagem
    resultado.dataFinalPrazo = somarDiasUteis(dataInicioPrazo, prazoDias - 1);
    resultado.prazoDias = prazoDias;
  }
  return resultado;
}

module.exports = { ehDiaUtil, ehFeriado, proximoDiaUtil, somarDiasUteis, calcularDatasArt224 };
