/*
  Usa o Gemini para traduzir o texto técnico de uma movimentação processual para
  uma explicação simples, destinada a um cliente leigo. Requer a variável de
  ambiente GEMINI_API_KEY (chave gratuita, obtida em https://aistudio.google.com/app/apikey).

  IMPORTANTE: o modelo "gemini-1.5-flash" usado na versão anterior foi
  desativado pelo Google (modelos antigos da série 1.5 e 2.0 já saíram do ar).
  Por isso passamos a usar o alias "gemini-flash-latest", mantido pelo próprio
  Google sempre apontando para a versão Flash estável mais recente — isso evita
  que o sistema quebre de novo a cada vez que o Google trocar de modelo.
  Também trocamos a biblioteca oficial (que está descontinuada) por uma chamada
  HTTP direta, mais simples de manter.
*/
async function explicarParaLeigo(textoMovimentacao) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { textoSimplificado: null, avisoIA: 'GEMINI_API_KEY não configurada — mostrando apenas o texto original.' };
  }

  const modelo = 'gemini-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
  const prompt = `Explique o seguinte andamento processual para um cliente leigo de forma muito simples e direta em no máximo duas frases: ${textoMovimentacao}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!resp.ok) {
      const corpoErro = await resp.text().catch(() => '');
      console.error('Erro na API do Gemini:', resp.status, corpoErro);
      return { textoSimplificado: null, avisoIA: 'Não foi possível gerar a explicação simplificada agora (IA indisponível) — mostrando o texto original.' };
    }
    const dados = await resp.json();
    const texto = dados?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) {
      console.error('Resposta do Gemini sem texto:', JSON.stringify(dados));
      return { textoSimplificado: null, avisoIA: 'Não foi possível gerar a explicação simplificada agora (IA indisponível) — mostrando o texto original.' };
    }
    return { textoSimplificado: texto.trim(), avisoIA: null };
  } catch (e) {
    console.error('Erro ao chamar o Gemini:', e);
    return { textoSimplificado: null, avisoIA: 'Não foi possível gerar a explicação simplificada agora (IA indisponível) — mostrando o texto original.' };
  }
}

module.exports = { explicarParaLeigo };
