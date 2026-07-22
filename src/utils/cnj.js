// Interpreta o número do processo no padrão CNJ (Resolução 65/2008):
//   NNNNNNN-DD.AAAA.J.TR.OOOO
// e descobre o "alias" do tribunal correspondente na API pública do Datajud
// (cada tribunal tem seu próprio índice, ex: api_publica_tjba, api_publica_trt5).
//
// Fonte da lógica de numeração: padrão público do CNJ. A lista de aliases
// deve ser conferida periodicamente na documentação oficial do Datajud
// (https://datajud-wiki.cnj.jus.br/api-publica/endpoints), pois o CNJ pode
// ajustar nomes de quando em quando.

// Ordem alfabética oficial usada pelo CNJ para os códigos de UF (segmento
// Estadual = 8, e também usada pela Eleitoral = 6).
const UFS_EM_ORDEM = [
  'ac','al','ap','am','ba','ce','df','es','go','ma','mt','ms','mg',
  'pa','pb','pr','pe','pi','rj','rn','rs','ro','rr','sc','sp','se','to',
];

function ufPorCodigo(codigo) {
  const i = parseInt(codigo, 10) - 1;
  return UFS_EM_ORDEM[i] || null;
}

function limparNumero(numeroCNJ) {
  return (numeroCNJ || '').replace(/\D/g, '');
}

/**
 * Recebe o número do processo (com ou sem pontuação) e devolve
 * { digitos, alias } ou lança erro se não for possível identificar o tribunal.
 */
function identificarTribunal(numeroCNJ) {
  const digitos = limparNumero(numeroCNJ);
  if (digitos.length !== 20) {
    throw new Error('Número de processo inválido. O padrão CNJ tem 20 dígitos (ex: 0000000-00.0000.0.00.0000).');
  }
  const segmento = digitos.substring(13, 14);
  const tr = digitos.substring(14, 16);

  let alias = null;
  switch (segmento) {
    case '1': // STF
      alias = 'stf';
      break;
    case '3': // STJ
      alias = 'stj';
      break;
    case '4': { // Justiça Federal — TRF1 a TRF6
      const regiao = parseInt(tr, 10);
      alias = `trf${regiao}`;
      break;
    }
    case '5': { // Justiça do Trabalho — TRT1 a TRT24
      const regiao = parseInt(tr, 10);
      alias = `trt${regiao}`;
      break;
    }
    case '6': { // Justiça Eleitoral — TRE por estado
      const uf = ufPorCodigo(tr);
      if (!uf) throw new Error('Não foi possível identificar o TRE para este número.');
      alias = `tre-${uf}`;
      break;
    }
    case '7': // Justiça Militar da União
      alias = 'stm';
      break;
    case '8': { // Justiça Estadual — TJ por estado
      const uf = ufPorCodigo(tr);
      if (!uf) throw new Error('Não foi possível identificar o Tribunal de Justiça para este número.');
      alias = `tj${uf}`;
      break;
    }
    case '9': // Justiça Militar Estadual (só existe em SP, MG e RS)
      throw new Error('Justiça Militar Estadual ainda não é suportada pela busca automática.');
    default:
      throw new Error('Segmento de justiça não reconhecido neste número de processo.');
  }

  return { digitos, alias };
}

module.exports = { identificarTribunal, limparNumero };
