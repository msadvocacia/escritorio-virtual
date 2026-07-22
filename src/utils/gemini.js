const { GoogleGenerativeAI } = require('@google/generative-ai');

/*
  Usa o Gemini (modelo gratuito "gemini-1.5-flash") para traduzir o texto técnico
  de uma movimentação processual para uma explicação simples, destinada a um
  cliente leigo. Requer a variável de ambiente GEMINI_API_KEY (chave gratuita,
  obtida em https://aistudio.google.com/app/apikey).
*/

async function explicarParaLeigo(textoMovimentacao) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Sem chave configurada: devolve o texto original com um aviso, em vez de quebrar a funcionalidade.
    return { textoSimplificado: null, avisoIA: 'GEMINI_API_KEY não configurada — mostrando apenas o texto original.' };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = `Explique o seguinte andamento processual para um cliente leigo de forma muito simples e direta em no máximo duas frases: ${textoMovimentacao}`;
    const resultado = await model.generateContent(prompt);
    const texto = resultado.response.text().trim();
    return { textoSimplificado: texto, avisoIA: null };
  } catch (e) {
    return { textoSimplificado: null, avisoIA: 'Não foi possível gerar a explicação simplificada agora (IA indisponível) — mostrando o texto original.' };
  }
}

module.exports = { explicarParaLeigo };
