const { identificarTribunal } = require('./cnj');

/*
  API Pública do Datajud (CNJ). Documentação oficial:
  https://datajud-wiki.cnj.jus.br/api-publica/

  Endpoint: POST https://api-publica.datajud.cnj.jus.br/api_publica_{alias}/_search
  Cabeçalho: Authorization: APIKey <DATAJUD_PUBLIC_KEY>

  A chave pública de exemplo divulgada pelo próprio CNJ na documentação é
  compartilhada entre todos os usuários (não é uma chave pessoal) — mesmo assim,
  colocamos em variável de ambiente (DATAJUD_PUBLIC_KEY) para não deixar hard-coded
  no código e para o caso de o CNJ passar a exigir chaves individuais no futuro.
*/

async function buscarUltimaMovimentacao(numeroCNJ) {
  const { digitos, alias } = identificarTribunal(numeroCNJ);
  const apiKey = process.env.DATAJUD_PUBLIC_KEY;
  if (!apiKey) {
    throw new Error('A consulta automática de andamentos ainda não foi ativada pelo escritório (falta configurar a chave do Datajud no servidor). Fale com o administrador do sistema.');
  }

  const url = `https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`;
  const corpo = {
    query: { match: { numeroProcesso: digitos } },
    size: 1,
  };

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `APIKey ${apiKey}`,
      },
      body: JSON.stringify(corpo),
    });
  } catch (e) {
    throw new Error('Não foi possível contatar a API pública do CNJ (Datajud) agora. Tente novamente mais tarde.');
  }

  if (!resp.ok) {
    if (resp.status === 404) {
      throw new Error(`Tribunal não encontrado na base do Datajud (alias "${alias}"). Confira a lista oficial de tribunais suportados.`);
    }
    throw new Error(`A API do Datajud respondeu com erro (status ${resp.status}).`);
  }

  const dados = await resp.json();
  const hit = dados && dados.hits && dados.hits.hits && dados.hits.hits[0];
  if (!hit || !hit._source) {
    throw new Error('Processo não encontrado na base pública do CNJ. Isso pode acontecer com processos em segredo de justiça, muito recentes, ou de tribunais ainda não totalmente indexados.');
  }

  const processo = hit._source;
  const movimentos = processo.movimentos || processo.movimento || [];
  if (!movimentos.length) {
    throw new Error('O processo foi encontrado, mas ainda não há movimentações registradas na base do CNJ.');
  }

  const ordenados = [...movimentos].sort((a, b) => {
    const da = new Date(a.dataHora || a.data || 0).getTime();
    const db = new Date(b.dataHora || b.data || 0).getTime();
    return db - da;
  });
  const ultimo = ordenados[0];

  const partes = [ultimo.nome || ultimo.descricao || 'Movimentação sem descrição'];
  if (Array.isArray(ultimo.complementosTabelados)) {
    ultimo.complementosTabelados.forEach((c) => {
      if (c && (c.nome || c.descricao)) partes.push(c.nome || c.descricao);
    });
  }

  return {
    dataMovimento: ultimo.dataHora || ultimo.data || null,
    textoOriginal: partes.join(' — '),
    tribunalAlias: alias,
  };
}

module.exports = { buscarUltimaMovimentacao };
