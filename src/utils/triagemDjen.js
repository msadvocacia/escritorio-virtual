/*
  Camada de "leitura e triagem" da intimação/publicação bruta do DJEN. O DJEN
  só devolve o texto corrido do ato processual — quem lê, decide se há prazo,
  de quantos dias, e para quem, é o próprio advogado (ou, aqui, uma IA que dá
  uma primeira leitura, sempre sujeita à conferência humana).

  Usa a API da Anthropic (Claude). Requer a variável de ambiente
  ANTHROPIC_API_KEY. Sem ela, a triagem automática fica indisponível e o
  registro precisa ser classificado manualmente pelo advogado — o sistema não
  trava por isso, só deixa de preencher sozinho.

  IMPORTANTE: isto é uma automação de PRIMEIRA LEITURA, não uma opinião
  jurídica. O resultado sempre deve ser conferido por um advogado antes de
  qualquer prazo ser considerado definitivo — por isso cada registro
  triado guarda o texto original inteiro, nunca só o resumo da IA.
*/

async function triarTextoComIA(textoComunicacao) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { sucesso: false, aviso: 'ANTHROPIC_API_KEY não configurada — classifique esta publicação manualmente.' };
  }
  if (!textoComunicacao || !textoComunicacao.trim()) {
    return { sucesso: false, aviso: 'Publicação sem texto para analisar.' };
  }

  const prompt = `Você vai analisar o texto de uma publicação/intimação de um diário oficial de justiça brasileiro. Leia com atenção e responda SOMENTE em JSON válido, sem nenhum texto antes ou depois, no formato exato abaixo:

{
  "temPrazo": true ou false,
  "prazoDias": número de dias do prazo mencionado (ou null se não houver ou não for possível identificar),
  "prazoUnidade": "uteis" ou "corridos" (dias úteis é a regra geral do CPC; só marque "corridos" se o texto disser expressamente, ex: prazo penal),
  "tipoAto": uma descrição curta do que é o ato (ex: "Manifestação sobre laudo pericial", "Contestação", "Recurso", "Ciência de decisão", "Intimação de audiência"),
  "responsavelNome": nome do advogado ou parte que deve praticar o ato, se identificável no texto (ou null),
  "resumo": um resumo em até 2 frases, em linguagem simples, do que a publicação exige
}

Texto da publicação:
"""
${textoComunicacao.slice(0, 6000)}
"""`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // modelo rápido e econômico — adequado para uma triagem simples repetida por publicação
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => '');
      console.error('Erro na API da Anthropic (triagem DJEN):', resp.status, corpo);
      return { sucesso: false, aviso: 'Não foi possível analisar automaticamente esta publicação agora — classifique manualmente.' };
    }
    const dados = await resp.json();
    const texto = dados?.content?.find((b) => b.type === 'text')?.text;
    if (!texto) return { sucesso: false, aviso: 'A IA não devolveu uma análise válida — classifique manualmente.' };

    // A IA foi instruída a responder só JSON, mas por segurança extraímos o
    // primeiro bloco { ... } caso venha algum texto extra em volta.
    const match = texto.match(/\{[\s\S]*\}/);
    if (!match) return { sucesso: false, aviso: 'A IA não devolveu um JSON reconhecível — classifique manualmente.' };
    const analise = JSON.parse(match[0]);
    return {
      sucesso: true,
      temPrazo: !!analise.temPrazo,
      prazoDias: analise.prazoDias ? parseInt(analise.prazoDias, 10) : null,
      prazoUnidade: analise.prazoUnidade === 'corridos' ? 'corridos' : 'uteis',
      tipoAto: analise.tipoAto || '',
      responsavelNome: analise.responsavelNome || '',
      resumo: analise.resumo || '',
    };
  } catch (e) {
    console.error('Erro ao chamar a API da Anthropic (triagem DJEN):', e.message);
    return { sucesso: false, aviso: 'Não foi possível analisar automaticamente esta publicação agora — classifique manualmente.' };
  }
}

module.exports = { triarTextoComIA };
