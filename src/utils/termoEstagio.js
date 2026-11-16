// Termos de compromisso de estágio (4 modelos):
//   1 — Estudante, não remunerado     2 — Estudante, remunerado
//   3 — Bacharel, não remunerado      4 — Bacharel, remunerado
// O texto de cada modelo vem dos arquivos do escritório; aqui só entram os
// campos preenchidos na criação do estagiário. A numeração dos itens é gerada
// automaticamente (1.1, 1.2... dentro de cada cláusula), então não sobra
// "7.1" dentro da Cláusula 5ª nem cláusula pulando de número.

const D = require('./docxBuilder');
const T = require('./textoJuridico');

const TAMANHO = 22; // 11 pt — um termo longo cabe em menos páginas
const TERMOS_DESTAQUE = [
  'ESTAGIÁRIO(A)', 'ESTAGIÁRIO', 'INSTITUIÇÃO DE ENSINO', 'INSTITUIÇÃO', 'ESCRITÓRIO', 'CONCEDENTE', 'NÃO OBRIGATÓRIO', 'PERMANENTE',
];

const CAMPOS_TEXTO = [
  'advogadoId', 'instNome', 'instCnpj', 'instEndereco', 'instRepresentante', 'matricula',
  'dataFormatura', 'dataColacao', 'inicio', 'termino', 'duracaoMeses', 'tipoPrazo', 'avisoPrevioDias', 'temporalidadeTexto',
  'horasDiarias', 'horasSemanais', 'bolsaOpcao', 'bolsaValor', 'bolsaDiaPagamento', 'bolsaPercentual', 'bolsaPrazoDias',
  'percIndicacao', 'impedimentoMeses', 'multaValor', 'dataAssinatura',
];
const CAMPOS_DATA = ['dataFormatura', 'dataColacao', 'inicio', 'termino', 'dataAssinatura'];

/** Mantém só os campos conhecidos, como texto curto — o que chega do navegador nunca é confiado como está. */
function sanitizar(t) {
  const origem = t && typeof t === 'object' ? t : {};
  const saida = {};
  CAMPOS_TEXTO.forEach((c) => {
    let v = origem[c] == null ? '' : String(origem[c]).trim();
    v = v.replace(/\*\*/g, '').slice(0, c === 'temporalidadeTexto' ? 3000 : 400);
    if (CAMPOS_DATA.includes(c) && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) v = '';
    saida[c] = v;
  });
  if (!['determinado', 'indeterminado'].includes(saida.tipoPrazo)) saida.tipoPrazo = 'determinado';
  if (!['A', 'B', 'C'].includes(saida.bolsaOpcao)) saida.bolsaOpcao = 'A';
  return saida;
}

function numeroDoTermo(formacao, remunerado) {
  const bacharel = formacao === 'bacharel';
  return (bacharel ? 3 : 1) + (remunerado ? 1 : 0);
}
const NOMES = {
  1: 'Termo 1 — Estágio Estudante Não Remunerado',
  2: 'Termo 2 — Estágio Estudante Remunerado',
  3: 'Termo 3 — Estágio Bacharel Não Remunerado',
  4: 'Termo 4 — Estágio Bacharel Remunerado',
};

// ---------- formatação de valores ----------
const BLANK = '__________';
function dataExt(iso) { return iso ? T.fmtDateExtenso(iso) : BLANK; }
function numeroBR(v) {
  if (v == null) return NaN;
  let s = String(v).replace(/R\$|\s/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}
function moeda(v) {
  const n = numeroBR(v);
  if (Number.isNaN(n)) return 'R$ __________ (______________________)';
  const [i, d] = n.toFixed(2).split('.');
  const milhar = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${milhar},${d} (${T.valorPorExtenso(n)})`;
}
/** "12" -> "12 (doze)"; vazio -> traço para preencher à mão. */
function numExt(v) {
  const n = numeroBR(v);
  if (Number.isNaN(n)) return BLANK;
  if (Number.isInteger(n) && n >= 0) return `${n} (${T.numberToWordsPT(n)})`;
  return String(v).trim();
}
function percentual(v) {
  const n = numeroBR(v);
  if (Number.isNaN(n)) return '____% (______________ por cento)';
  if (Number.isInteger(n)) return `${n}% (${T.numberToWordsPT(n)} por cento)`;
  const [i, d] = String(n).split('.');
  const dec = d.split('').map((x) => T.numberToWordsPT(parseInt(x, 10))).join(' ');
  return `${String(n).replace('.', ',')}% (${T.numberToWordsPT(parseInt(i, 10))} vírgula ${dec} por cento)`;
}
function percentualCurto(v) {
  const n = numeroBR(v);
  return Number.isNaN(n) ? '____%' : `${String(n).replace('.', ',')}%`;
}
function ou(v, vazio = BLANK) { return v && String(v).trim() ? String(v).trim() : vazio; }

// ---------- texto padrão da temporalidade (3.2) ----------
function textoTemporalidadePadrao(formacao, tipoPrazo, avisoPrevioDias) {
  const aviso = numExt(avisoPrevioDias);
  if (tipoPrazo === 'indeterminado') {
    return formacao === 'bacharel'
      ? `O estágio vigorará por prazo indeterminado, dentro do limite máximo legal, podendo ser extinto por qualquer das partes mediante aviso prévio por escrito de ${aviso} dias, ressalvada justa causa.`
      : `O estágio vigorará por prazo indeterminado, dentro do limite máximo legal do item 3.1, podendo ser extinto por qualquer das partes mediante aviso prévio por escrito de ${aviso} dias, sem necessidade de motivação, ressalvada a hipótese de justa causa.`;
  }
  return `O estágio vigorará por prazo determinado, extinguindo-se no termo final indicado no item 3.1, sem prejuízo de poder ser extinto, antes dele, por qualquer das partes mediante aviso prévio por escrito de ${aviso} dias, ressalvada a hipótese de justa causa.`;
}

// ---------- montagem das cláusulas ----------
function montarClausulas({ estudante, rem, t, adv }) {
  const supervisor = adv ? `${adv.nome}, OAB/BA nº ${ou(adv.oab)}` : '__________________________, OAB/BA nº ________';
  const aviso = numExt(t.avisoPrevioDias || '10');
  const indeterminado = t.tipoPrazo === 'indeterminado';
  const cl = [];

  // 1 — ENQUADRAMENTO
  if (estudante) {
    cl.push({ t: 'DO ENQUADRAMENTO JURÍDICO', items: [
      'O(A) ESTAGIÁRIO(A) está regularmente matriculado(a) e cursando com frequência efetiva o curso de Direito na INSTITUIÇÃO, condição essencial e permanente para a validade deste estágio, comprometendo-se o(a) ESTAGIÁRIO(A) a comunicar imediatamente ao ESCRITÓRIO qualquer trancamento, transferência, conclusão ou abandono do curso.',
      'Este estágio é classificado como NÃO OBRIGATÓRIO.',
      'O estágio, observados os requisitos do art. 3º da Lei nº 11.788/2008 (matrícula e frequência regular; celebração deste Termo entre ESTAGIÁRIO, ESCRITÓRIO e INSTITUIÇÃO; compatibilidade entre as atividades exercidas e as previstas neste instrumento), não gera vínculo empregatício de qualquer natureza. O descumprimento de qualquer desses requisitos, ou de obrigação aqui prevista, caracteriza vínculo de emprego para todos os fins da legislação trabalhista e previdenciária (art. 3º, §2º, da Lei nº 11.788/2008).',
    ] });
  } else {
    cl.push({ t: 'DO ENQUADRAMENTO JURÍDICO', items: [
      `O(A) ESTAGIÁRIO(A) é bacharel em Direito, tendo colado grau em **${dataExt(t.dataColacao)}**, não estando matriculado(a) em curso de graduação em Direito, realizando o presente estágio como requisito necessário à sua inscrição no quadro de estagiários da OAB, nos termos do art. 9º da Lei nº 8.906/1994 e do Provimento CFOAB vigente, pelo prazo máximo legal contado da colação de grau — cabendo às partes confirmar, na assinatura deste instrumento, o prazo máximo então vigente na regulamentação da OAB (2 anos, segundo o Provimento nº 217/2023, art. 2º, §1º, na redação vigente à época da elaboração deste modelo, sujeito a alteração posterior pela OAB).`,
      'O ESCRITÓRIO declara estar previamente credenciado perante a OAB/BA para essa modalidade de estágio e conta com advogado(a) supervisor(a) inscrito(a), respeitado o limite de estagiários por supervisor fixado na regulamentação da OAB.',
      'O estágio não gera vínculo empregatício de qualquer natureza entre as partes, desde que observados os requisitos legais e regulamentares aplicáveis, comprometendo-se o ESCRITÓRIO a preservar as condições que asseguram essa natureza jurídica.',
    ] });
  }

  // 2 — OBJETO
  if (estudante) {
    cl.push({ t: 'DO OBJETO E DO PLANO DE ATIVIDADES', items: [
      'O estágio consiste no acompanhamento e na prática, sob supervisão, de atividades compatíveis com o curso de Direito, como ato educativo escolar supervisionado que visa à preparação do(a) ESTAGIÁRIO(A) para o trabalho produtivo, vedado o exercício de atos privativos de advogado (art. 1º da Lei nº 8.906/1994).',
      'Integram o plano de atividades: pesquisa doutrinária e jurisprudencial; elaboração de minutas de peças, sob revisão do(a) advogado(a) supervisor(a); organização processual e documental; acompanhamento de audiências e diligências; atendimento a clientes na presença do(a) supervisor(a); e demais tarefas compatíveis, nos termos do Anexo de Plano de Atividades, a ser incorporado por aditivo conforme a evolução do estágio (art. 7º, §1º-A, da Lei nº 11.788/2008).',
      `Advogado(a) supervisor(a) responsável: **${supervisor}**.`,
    ] });
  } else {
    cl.push({ t: 'DO OBJETO E DO PLANO DE ATIVIDADES', items: [
      'O estágio compreende exclusivamente atividades de natureza prática, incluindo o estudo e a análise do Estatuto da Advocacia e da OAB, de seu Regulamento Geral e do Código de Ética e Disciplina, além de: redação de minutas de atos processuais e profissionais, sob revisão e responsabilidade do(a) advogado(a) supervisor(a); acompanhamento das rotinas processuais; assistência e atuação em audiências e sessões, sempre sob supervisão; visitas a órgãos judiciários; e técnicas de negociação, conciliação e arbitragem, vedado o exercício isolado de atos privativos de advogado.',
      `Advogado(a) supervisor(a) responsável: **${supervisor}**.`,
    ] });
  }

  // 3 — DURAÇÃO (o 2º item é o parágrafo editável da temporalidade)
  const limite = rem ? '2 (dois) anos' : '1 (um) ano';
  let item31;
  if (estudante) {
    item31 = indeterminado
      ? `O estágio terá início em **${dataExt(t.inicio)}**, respeitado o limite máximo de ${limite} junto ao mesmo ESCRITÓRIO, salvo estagiário portador de deficiência (art. 11 da Lei nº 11.788/2008).`
      : `O estágio terá início em **${dataExt(t.inicio)}** e término em **${dataExt(t.termino)}**, com duração de **${numExt(t.duracaoMeses)}** meses, respeitado o limite máximo de ${limite} junto ao mesmo ESCRITÓRIO, salvo estagiário portador de deficiência (art. 11 da Lei nº 11.788/2008), podendo ser prorrogado mediante termo aditivo firmado por todas as partes.`;
  } else {
    item31 = indeterminado
      ? `O estágio terá início em **${dataExt(t.inicio)}**, respeitado o prazo máximo legal contado da colação de grau referido na Cláusula 1ª.`
      : `O estágio terá início em **${dataExt(t.inicio)}** e término em **${dataExt(t.termino)}**, com duração de **${numExt(t.duracaoMeses)}** meses, respeitado o prazo máximo legal contado da colação de grau referido na Cláusula 1ª, podendo ser prorrogado dentro desse limite mediante termo aditivo.`;
  }
  const item32 = (t.temporalidadeTexto && t.temporalidadeTexto.trim())
    ? t.temporalidadeTexto.trim()
    : textoTemporalidadePadrao(estudante ? 'estudante' : 'bacharel', indeterminado ? 'indeterminado' : 'determinado', t.avisoPrevioDias || '10');
  cl.push({ t: 'DA DURAÇÃO', items: [item31, item32] });

  // 4 — JORNADA
  const jornada = `A jornada será de até **${numExt(t.horasDiarias)}** horas diárias e **${numExt(t.horasSemanais)}** horas semanais`;
  if (estudante) {
    cl.push({ t: 'DA JORNADA', items: [
      `${jornada}, respeitado o limite de 6 (seis) horas diárias e 30 (trinta) horas semanais, salvo se o curso adotar alternância entre teoria e prática, em períodos sem aulas presenciais, hipótese em que a jornada poderá ser de até 40 (quarenta) horas semanais, desde que previsto no projeto pedagógico e atestado pela INSTITUIÇÃO (art. 10 da Lei nº 11.788/2008).`,
      'A carga horária será reduzida à metade nos períodos de avaliação acadêmica, mediante comprovação pelo(a) ESTAGIÁRIO(A).',
    ] });
  } else {
    cl.push({ t: 'DA JORNADA', items: [
      `${jornada}, observados os parâmetros da Lei nº 11.788/2008 aplicáveis por analogia e a regulamentação da OAB, em horário compatível com eventual atividade profissional do(a) ESTAGIÁRIO(A).`,
    ] });
  }

  // 5 — BOLSA (só nos termos remunerados e no bacharel não remunerado, que declara a ausência)
  if (rem) {
    const op = t.bolsaOpcao;
    let paragrafo;
    if (op === 'B') {
      paragrafo = `O(A) ESTAGIÁRIO(A) receberá, a título de bolsa/contraprestação, o percentual de **${percentual(t.bolsaPercentual)}** sobre os honorários efetivamente recebidos pelo ESCRITÓRIO nos processos ou trabalhos em que houver participação comprovada e relevante do(a) ESTAGIÁRIO(A), sob supervisão do(a) advogado(a) responsável, apurado e pago em até **${numExt(t.bolsaPrazoDias)}** dias após o recebimento pelo ESCRITÓRIO, mediante demonstrativo de cálculo e recibo.`;
    } else if (op === 'C') {
      paragrafo = `O(A) ESTAGIÁRIO(A) receberá bolsa fixa mensal de **${moeda(t.bolsaValor)}**, a ser paga até o dia **${ou(t.bolsaDiaPagamento)}** de cada mês, acrescida de participação percentual de **${percentual(t.bolsaPercentual)}** sobre honorários de êxito em trabalhos com participação comprovada e relevante do(a) ESTAGIÁRIO(A), sob supervisão do(a) advogado(a) responsável, apurada e paga em até **${numExt(t.bolsaPrazoDias)}** dias após o recebimento pelo ESCRITÓRIO, mediante demonstrativo de cálculo e recibo.`;
    } else {
      paragrafo = `O(A) ESTAGIÁRIO(A) receberá bolsa mensal no valor de **${moeda(t.bolsaValor)}**, a ser paga até o dia **${ou(t.bolsaDiaPagamento)}** de cada mês, mediante depósito em conta de sua titularidade, independentemente do número de casos ou trabalhos em que venha a colaborar no período.`;
    }
    if (estudante) {
      cl.push({ t: 'DA BOLSA E DEMAIS CONDIÇÕES', items: [
        'Por se tratar de estágio remunerado, é devida ao(à) ESTAGIÁRIO(A) bolsa ou outra forma de contraprestação, além do auxílio-transporte, nos termos do art. 12 da Lei nº 11.788/2008 — obrigatórios se o estágio for classificado como NÃO OBRIGATÓRIO na Cláusula 1.2; facultativos, por liberalidade do ESCRITÓRIO ora formalizada, se OBRIGATÓRIO.',
        'As partes ajustam a contraprestação na seguinte forma:',
        { corpo: paragrafo },
        'A bolsa não configura remuneração para fins trabalhistas nem gera, por si só, vínculo empregatício, na forma do art. 12, §2º, da Lei nº 11.788/2008, desde que mantidos os demais requisitos legais do estágio.',
        'Fica facultado às partes, mediante termo aditivo firmado inclusive pela INSTITUIÇÃO quando exigível, alterar a forma de contraprestação escolhida acima, sem necessidade de rescisão do presente instrumento.',
      ] });
    } else {
      cl.push({ t: 'DA BOLSA E DEMAIS CONDIÇÕES', items: [
        'As partes ajustam a concessão de bolsa/contraprestação ao(à) ESTAGIÁRIO(A), na seguinte forma:',
        { corpo: paragrafo },
        'A bolsa não configura remuneração para fins trabalhistas nem gera, por si só, vínculo empregatício, mantidos os demais requisitos legais e regulamentares do estágio profissional de advocacia.',
        'A forma de contraprestação escolhida poderá ser alterada mediante termo aditivo firmado por ambas as partes.',
      ] });
    }
  } else if (!estudante) {
    cl.push({ t: 'DA AUSÊNCIA DE BOLSA', items: [
      'As partes ajustam que este estágio será prestado sem contraprestação pecuniária, por liberalidade e concordância expressa do(a) ESTAGIÁRIO(A), o que não desnatura o estágio, dado que a legislação aplicável ao estágio profissional de advocacia não impõe, nesta hipótese, a concessão obrigatória de bolsa.',
    ] });
  }

  // RECESSO
  if (estudante) {
    cl.push({ t: 'DO RECESSO', items: [
      `Se o estágio tiver duração igual ou superior a 1 (um) ano, o(a) ESTAGIÁRIO(A) terá direito a recesso${rem ? ' remunerado' : ''} de 30 (trinta) dias, preferencialmente durante as férias escolares (art. 13 da Lei nº 11.788/2008). Nos estágios de duração inferior, o recesso será concedido de forma proporcional.`,
    ] });
  } else {
    cl.push({ t: 'DO RECESSO', items: [
      `Se o estágio tiver duração igual ou superior a 1 (um) ano, o(a) ESTAGIÁRIO(A) terá direito a recesso${rem ? ' remunerado' : ''} de 30 (trinta) dias, por aplicação analógica do art. 13 da Lei nº 11.788/2008 e conforme a regulamentação da OAB.`,
    ] });
  }

  // CONFIDENCIALIDADE
  const conf2 = (estudante)
    ? 'O(A) ESTAGIÁRIO(A) obriga-se a: (i) manter sigilo absoluto sobre dados, documentos, estratégias e informações a que tiver acesso; (ii) utilizá-los exclusivamente para as atividades do estágio; (iii) não copiar, reproduzir ou transmitir tais informações a terceiros, por qualquer meio; (iv) devolver ou destruir todo material físico ou digital em sua posse ao término do estágio; e (v) observar as medidas de segurança da informação determinadas pelo ESCRITÓRIO, na qualidade de pessoa autorizada ao tratamento de dados sob a responsabilidade do ESCRITÓRIO como controlador (art. 5º, IX, e art. 39 da Lei nº 13.709/2018).'
    : 'O(A) ESTAGIÁRIO(A) obriga-se a: (i) manter sigilo absoluto sobre dados, documentos, estratégias e informações a que tiver acesso; (ii) utilizá-los exclusivamente para as atividades do estágio; (iii) não copiar, reproduzir ou transmitir tais informações a terceiros; (iv) devolver ou destruir todo material físico ou digital em sua posse ao término do estágio; e (v) observar as medidas de segurança da informação determinadas pelo ESCRITÓRIO, na qualidade de pessoa autorizada ao tratamento de dados sob a responsabilidade do ESCRITÓRIO como controlador (art. 5º, IX, e art. 39 da Lei nº 13.709/2018).';
  cl.push({ t: 'DA CONFIDENCIALIDADE E DO SIGILO PROFISSIONAL', items: [
    'O(A) ESTAGIÁRIO(A) terá acesso a informações e dados pessoais e processuais de clientes do ESCRITÓRIO, protegidos por sigilo profissional (art. 34, VII, da Lei nº 8.906/1994; Código de Ética e Disciplina da OAB) e pela Lei nº 13.709/2018 (LGPD).',
    conf2,
    estudante
      ? 'A obrigação de sigilo prevista nesta cláusula é de natureza PERMANENTE e subsiste indefinidamente após o término do estágio, por qualquer motivo, não estando sujeita a prazo de vigência, em razão da natureza perene do sigilo profissional advocatício.'
      : 'A obrigação de sigilo prevista nesta cláusula é de natureza PERMANENTE e subsiste indefinidamente após o término do estágio, por qualquer motivo.',
    estudante
      ? 'O descumprimento do dever de sigilo sujeita o(a) ESTAGIÁRIO(A), conforme o caso: (i) às sanções cíveis por perdas e danos (arts. 186, 187 e 927 do Código Civil); (ii) às sanções penais previstas no art. 154 do Código Penal (violação de segredo profissional) e, quando configurado, no art. 153 do mesmo diploma; e (iii) às sanções administrativas previstas na Lei nº 13.709/2018 que sejam pessoalmente imputáveis ao infrator.'
      : 'O descumprimento sujeita o(a) infrator(a): (i) a perdas e danos (arts. 186, 187 e 927 do Código Civil); (ii) às sanções penais do art. 154 do Código Penal (e, se cabível, art. 153); (iii) às sanções administrativas da Lei nº 13.709/2018 pessoalmente imputáveis; e (iv), por já ser bacharel candidato à inscrição na OAB, à eventual repercussão em seu processo de inscrição, conforme apurado pela própria OAB.',
  ] });

  // RESPONSABILIDADE
  if (estudante) {
    cl.push({ t: 'DA RESPONSABILIDADE POR DADOS E INFORMAÇÕES', items: [
      'O(A) ESTAGIÁRIO(A) assume, perante o ESCRITÓRIO, responsabilidade pessoal, integral e exclusiva por qualquer vazamento, uso indevido, divulgação não autorizada ou perda de dados e informações de clientes ou do ESCRITÓRIO que decorra de ação ou omissão, dolosa ou culposa, de sua própria autoria, no exercício ou por ocasião do estágio.',
      'Caso o ESCRITÓRIO, seus sócios ou associados venham a ser responsabilizados perante clientes, terceiros ou autoridades por ato do(a) ESTAGIÁRIO(A) praticado com dolo ou culpa, fica desde já assegurado ao ESCRITÓRIO o direito de regresso integral contra o(a) ESTAGIÁRIO(A), nos termos do art. 934 do Código Civil, pelo valor total de eventuais indenizações, multas ou sanções pagas, sem prejuízo de outras medidas cabíveis.',
    ] });
  } else {
    cl.push({ t: 'DA RESPONSABILIDADE POR DADOS E INFORMAÇÕES', items: [
      'O(A) ESTAGIÁRIO(A) responde pessoal, integral e exclusivamente perante o ESCRITÓRIO por vazamento, uso indevido, divulgação não autorizada ou perda de dados/informações decorrente de ação ou omissão, dolosa ou culposa, de sua própria autoria.',
      'Caso o ESCRITÓRIO, seus sócios ou associados sejam responsabilizados perante clientes, terceiros ou autoridades por ato doloso ou culposo do(a) ESTAGIÁRIO(A), fica assegurado ao ESCRITÓRIO direito de regresso integral contra o(a) ESTAGIÁRIO(A) (art. 934 do Código Civil), pelo valor total de indenizações, multas ou sanções suportadas.',
    ] });
  }

  // CAPTAÇÃO / INDICAÇÃO
  if (estudante) {
    cl.push({ t: 'DA VEDAÇÃO À CAPTAÇÃO DE CLIENTELA E DA GRATIFICAÇÃO POR INDICAÇÃO', items: [
      'É vedado ao(à) ESTAGIÁRIO(A), durante e após o estágio, oferecer, prometer ou anunciar os serviços do ESCRITÓRIO de forma que configure angariação ou captação de causas, nos termos do art. 34, III e IV, do Estatuto da Advocacia e da OAB, e dos arts. 5º e 39 a 41 do Código de Ética e Disciplina da OAB.',
      `Nos casos em que o(a) ESTAGIÁRIO(A), no exercício regular e ético de suas atividades, apresentar espontaneamente ao ESCRITÓRIO pessoa que venha a se tornar cliente, e desde que tal indicação não configure a vedação do item {n}.1 nem qualquer forma de agenciamento remunerado de causas, fará jus a uma gratificação equivalente a **${percentual(t.percIndicacao)}** sobre os honorários que, do total do êxito ou contrato, cabem ao ESCRITÓRIO — fixados, para efeitos deste contrato, em 30% (trinta por cento) do valor total —, a ser paga exclusivamente após o efetivo recebimento dos honorários pelo ESCRITÓRIO, mediante recibo.`,
      'A gratificação prevista nesta cláusula não possui natureza de participação em honorários advocatícios para fins do art. 34, III, do Estatuto da OAB, tratando-se de mera liberalidade do ESCRITÓRIO, condicionada à ausência de qualquer prática de intermediação, agenciamento ou publicidade vedada pela ética profissional, cabendo ao ESCRITÓRIO, a seu critério, negar o pagamento caso identifique tal prática.',
    ] });
  } else {
    cl.push({ t: 'DA VEDAÇÃO À CAPTAÇÃO DE CLIENTELA E DA GRATIFICAÇÃO POR INDICAÇÃO', items: [
      'É vedado ao(à) ESTAGIÁRIO(A), durante e após o estágio, angariar ou captar causas, com ou sem intervenção de terceiros (art. 34, III e IV, do Estatuto da Advocacia e da OAB; arts. 5º e 39 a 41 do Código de Ética e Disciplina da OAB) — vedação especialmente relevante aqui, por se tratar de futuro(a) candidato(a) à inscrição como advogado(a).',
      `Quando o(a) ESTAGIÁRIO(A) apresentar espontaneamente ao ESCRITÓRIO pessoa que venha a se tornar cliente, sem configurar a vedação do item {n}.1, fará jus a gratificação de **${percentualCurto(t.percIndicacao)}** sobre os honorários que, do total recebido, cabem ao ESCRITÓRIO — fixados em 30% (trinta por cento) para efeitos deste contrato —, paga somente após o efetivo recebimento, mediante recibo.`,
      'Trata-se de liberalidade do ESCRITÓRIO, não configurando participação em honorários para fins do art. 34, III, do Estatuto da OAB, condicionada à ausência de qualquer prática vedada pela ética profissional.',
    ] });
  }

  // IMPEDIMENTO
  const prazoImp = `**${numExt(t.impedimentoMeses)}** meses`;
  const multa = `**${moeda(t.multaValor)}**`;
  if (estudante) {
    cl.push({ t: 'DO IMPEDIMENTO TEMPORÁRIO PÓS-ESTÁGIO', items: [
      `Encerrado o estágio, por qualquer motivo, o(a) ESTAGIÁRIO(A) obriga-se a, pelo prazo de ${prazoImp} contados do desligamento, abster-se de: (i) prestar, direta ou indiretamente, serviços advocatícios ou de assessoria jurídica a clientes que tenham sido atendidos pelo ESCRITÓRIO durante o período do estágio e com os quais o(a) ESTAGIÁRIO(A) tenha tido contato direto; e (ii) utilizar informações confidenciais obtidas durante o estágio para captar, aliciar ou atender tais clientes.`,
      'A obrigação prevista nesta cláusula não impede o livre exercício da advocacia pelo(a) ex-estagiário(a) de forma geral, limitando-se exclusivamente à clientela específica do ESCRITÓRIO nos termos do item {n}.1, em respeito à garantia constitucional de livre exercício profissional (art. 5º, XIII, da Constituição Federal).',
      `O descumprimento desta cláusula sujeitará o(a) ex-estagiário(a) ao pagamento de multa (cláusula penal, arts. 408 a 416 do Código Civil) no valor de ${multa}, sem prejuízo da apuração de perdas e danos efetivamente comprovados (arts. 389 e 402 do Código Civil) e, se caracterizado desvio de clientela mediante uso de informação confidencial, das sanções cíveis e penais aplicáveis à concorrência desleal (art. 195 c/c art. 209 da Lei nº 9.279/1996).`,
    ] });
  } else {
    cl.push({ t: 'DO IMPEDIMENTO TEMPORÁRIO PÓS-ESTÁGIO', items: [
      `Encerrado o estágio, o(a) ex-estagiário(a) obriga-se, pelo prazo de ${prazoImp}, a abster-se de: (i) prestar serviços advocatícios, direta ou indiretamente, a clientes do ESCRITÓRIO com os quais tenha tido contato direto durante o estágio; e (ii) utilizar informações confidenciais obtidas no estágio para captar tal clientela — inclusive após sua eventual inscrição como advogado(a) na OAB.`,
      'A restrição não impede o exercício geral da advocacia, limitando-se à clientela específica do item {n}.1, em respeito ao art. 5º, XIII, da Constituição Federal.',
      `O descumprimento sujeita o(a) infrator(a) a multa (cláusula penal, arts. 408 a 416 do Código Civil) de ${multa}, sem prejuízo de perdas e danos comprovados (arts. 389 e 402 do Código Civil) e, se houver desvio de clientela mediante informação confidencial, das sanções cíveis e penais da concorrência desleal (art. 195 c/c art. 209 da Lei nº 9.279/1996).`,
    ] });
  }

  // EXTINÇÃO
  if (estudante) {
    cl.push({ t: 'DA EXTINÇÃO DO ESTÁGIO', items: [
      `O estágio extingue-se: (i) automaticamente, ao término do prazo, se determinado; (ii) por conclusão ou abandono do curso, trancamento de matrícula, transferência de instituição de ensino ou desligamento do curso de Direito; (iii) a pedido do(a) ESTAGIÁRIO(A); (iv) por iniciativa do ESCRITÓRIO, a qualquer tempo, mediante aviso prévio de ${aviso} dias, salvo justa causa; e (v) imediatamente, por justa causa, em caso de descumprimento de obrigação prevista neste instrumento, das normas éticas da profissão ou de conduta incompatível com o ambiente do escritório.`,
    ] });
  } else {
    cl.push({ t: 'DA EXTINÇÃO DO ESTÁGIO', items: [
      `O estágio extingue-se: (i) ao término do prazo ou do limite máximo legal contado da colação de grau; (ii) a pedido do(a) ESTAGIÁRIO(A); (iii) por iniciativa do ESCRITÓRIO, mediante aviso prévio de ${aviso} dias, salvo justa causa; (iv) imediatamente, por justa causa, em caso de descumprimento contratual, ético ou de conduta incompatível; e (v) pela inscrição do(a) ESTAGIÁRIO(A) como advogado(a) nos quadros da OAB, hipótese em que cessa automaticamente a condição de estagiário.`,
    ] });
  }

  // FORO
  cl.push({ t: 'DO FORO', items: [
    estudante
      ? 'Fica eleito o foro da comarca de Jequié/BA para dirimir quaisquer controvérsias oriundas deste instrumento, com renúncia a qualquer outro, por mais privilegiado que seja.'
      : 'Fica eleito o foro da comarca de Jequié/BA para dirimir quaisquer controvérsias oriundas deste instrumento, com renúncia a qualquer outro.',
  ] });
  return cl;
}

const ORDINAL = (n) => `${n}ª`;

/** Negrito nos termos definidos e nos trechos marcados com ** ... **. */
function runsRicos(texto) {
  const partes = String(texto).split('**');
  const runs = [];
  partes.forEach((parte, i) => {
    if (!parte) return;
    if (i % 2 === 1) { runs.push(D.run(parte, { bold: true, sizeHalfPt: TAMANHO })); return; }
    let restante = parte;
    while (restante.length) {
      let melhorIdx = -1; let melhor = null;
      for (const termo of TERMOS_DESTAQUE) {
        const idx = restante.indexOf(termo);
        if (idx !== -1 && (melhorIdx === -1 || idx < melhorIdx)) { melhorIdx = idx; melhor = termo; }
      }
      if (melhorIdx === -1) { runs.push(D.run(restante, { sizeHalfPt: TAMANHO })); break; }
      if (melhorIdx > 0) runs.push(D.run(restante.slice(0, melhorIdx), { sizeHalfPt: TAMANHO }));
      runs.push(D.run(melhor, { bold: true, sizeHalfPt: TAMANHO }));
      restante = restante.slice(melhorIdx + melhor.length);
    }
  });
  return runs;
}
const par = (texto, opts) => D.paragraph(runsRicos(texto), opts);
// Mantém o fecho (frase final, data e assinaturas) junto na mesma página.
function manterJunto(xml) {
  if (xml === '<w:p/>') return '<w:p><w:pPr><w:keepNext/></w:pPr></w:p>';
  if (xml.startsWith('<w:p><w:pPr>')) return xml.replace('<w:p><w:pPr>', '<w:p><w:pPr><w:keepNext/>');
  return xml.replace('<w:p>', '<w:p><w:pPr><w:keepNext/></w:pPr>');
}

/**
 * dados: { nome, nacionalidade, estadoCivil, rg, cpf, endereco, formacaoEstagiario, remunerado, termoEstagio }
 * advogado: usuário (sócio/associado) escolhido como responsável — ou null.
 */
function gerarCorpoTermo({ dados: dadosBrutos, advogado: advBruto, config }) {
  // "**" é a marca de negrito interna: nunca deixa um dado digitado virar formatação.
  const lim = (v) => String(v == null ? '' : v).replace(/\*\*/g, '');
  const dados = {
    nome: lim(dadosBrutos.nome), nacionalidade: lim(dadosBrutos.nacionalidade), estadoCivil: lim(dadosBrutos.estadoCivil),
    rg: lim(dadosBrutos.rg), cpf: lim(dadosBrutos.cpf), endereco: lim(dadosBrutos.endereco),
    formacaoEstagiario: dadosBrutos.formacaoEstagiario, remunerado: dadosBrutos.remunerado, termoEstagio: dadosBrutos.termoEstagio,
  };
  const advogado = advBruto ? { nome: lim(advBruto.nome), oab: lim(advBruto.oab) } : null;
  const t = sanitizar(dados.termoEstagio);
  const estudante = dados.formacaoEstagiario !== 'bacharel';
  const rem = !!dados.remunerado;
  const numero = numeroDoTermo(estudante ? 'estudante' : 'bacharel', rem);
  const endEscritorio = (config && config.endereco) || 'Rua Frederico Costa, nº 124, Centro, Jequié/BA, CEP 45.200-225';
  const nomeAdv = advogado ? advogado.nome.toUpperCase() : '__________________________';
  const oabAdv = advogado ? ou(advogado.oab) : '________';
  const nomeEst = dados.nome ? String(dados.nome).toUpperCase() : '__________________________';

  const corpo = [];
  corpo.push(D.paragraph(D.run(estudante ? 'TERMO DE COMPROMISSO DE ESTÁGIO CURRICULAR' : 'TERMO DE COMPROMISSO DE ESTÁGIO PROFISSIONAL DE ADVOCACIA', { bold: true, sizeHalfPt: 26 }), { center: true, justify: false }));
  const base = estudante ? '(Lei nº 11.788/2008)' : '(Lei nº 8.906/1994, art. 9º, e Provimento CFOAB nº 217/2023)';
  corpo.push(D.paragraph(D.run(`${base} — MODALIDADE ${rem ? 'REMUNERADA' : 'NÃO REMUNERADA'}`, { bold: true, sizeHalfPt: TAMANHO }), { center: true, justify: false }));
  corpo.push(D.blank());

  corpo.push(par(`**CONCEDENTE:** **MS ADVOCACIA**, escritório de advocacia, com sede na ${endEscritorio}, neste ato representado por **${nomeAdv}**, advogado(a), OAB/BA nº ${oabAdv}, doravante ESCRITÓRIO;`));
  const qualificacao = `${ou(dados.nacionalidade, 'brasileiro(a)')}, ${ou(dados.estadoCivil, '__________')}, portador(a) do RG nº ${ou(dados.rg)} e CPF nº ${dados.cpf ? T.formatCPF(dados.cpf) : BLANK}, residente e domiciliado(a) em ${ou(dados.endereco, '______________________________')}`;
  if (estudante) {
    corpo.push(par(`**ESTAGIÁRIO(A):** **${nomeEst}**, ${qualificacao}, regularmente matriculado(a) sob o nº ${ou(t.matricula)} no curso de Direito da instituição de ensino abaixo qualificada, doravante ESTAGIÁRIO;`));
    corpo.push(par(`**INSTITUIÇÃO DE ENSINO:** **${ou(t.instNome, '__________________________')}**, CNPJ nº ${ou(t.instCnpj)}, com sede em ${ou(t.instEndereco, '______________________________')}, neste ato representada por ${ou(t.instRepresentante, '______________________')}, doravante INSTITUIÇÃO, interveniente-anuente obrigatória nos termos do art. 3º, II, da Lei nº 11.788/2008;`));
    corpo.push(par('As partes celebram o presente Termo de Compromisso de Estágio, regido pela Lei nº 11.788/2008, pela Lei nº 8.906/1994 (Estatuto da Advocacia e da OAB) e seu Regulamento Geral, pelo Código de Ética e Disciplina da OAB, pela Lei nº 13.709/2018 (LGPD) e pelo Código Civil, mediante as cláusulas seguintes.'));
  } else {
    corpo.push(par(`**ESTAGIÁRIO(A):** **${nomeEst}**, ${qualificacao}, bacharel em Direito, formado(a) em ${dataExt(t.dataFormatura)} pela instituição **${ou(t.instNome, '__________________________')}**, doravante ESTAGIÁRIO;`));
    corpo.push(par('As partes celebram o presente Termo de Compromisso de Estágio Profissional de Advocacia, regido pela Lei nº 8.906/1994 e seu Regulamento Geral, pelo Provimento CFOAB nº 217/2023 (ou pelo provimento que estiver vigente na data de assinatura — a confirmar junto à OAB/BA), pelo Código de Ética e Disciplina da OAB, subsidiariamente pela Lei nº 11.788/2008 no que for compatível, pela Lei nº 13.709/2018 (LGPD) e pelo Código Civil.'));
  }
  corpo.push(D.blank());

  const clausulas = montarClausulas({ estudante, rem, t: { ...t, avisoPrevioDias: t.avisoPrevioDias || '10' }, adv: advogado });
  clausulas.forEach((c, idx) => {
    const n = idx + 1;
    corpo.push(D.paragraph(D.run(`CLÁUSULA ${ORDINAL(n)} — ${c.t}`, { bold: true, sizeHalfPt: TAMANHO }), { center: true, justify: false }));
    let k = 0;
    c.items.forEach((item) => {
      if (typeof item === 'object' && item.corpo) {
        corpo.push(par(item.corpo, { indentCm: 1 }));
        return;
      }
      k += 1;
      const texto = String(item).replace(/\{n\}/g, String(n));
      corpo.push(par(`${n}.${k}. ${texto}`));
    });
    corpo.push(D.blank());
  });

  corpo.push(manterJunto(par('E, por estarem assim justas e contratadas, as partes assinam o presente instrumento em 2 vias de igual teor.')));
  const ano = new Date().getFullYear();
  const dataAss = t.dataAssinatura ? T.fmtDateExtenso(t.dataAssinatura) : `____ de ______________ de ${ano}`;
  corpo.push(manterJunto(D.paragraph(D.run(`Jequié/BA, ${dataAss}.`, { sizeHalfPt: TAMANHO }), { justify: false })));
  corpo.push(manterJunto(D.blank()));
  corpo.push(manterJunto(D.blank()));

  const linha = '________________________________';
  const cell = (txt, bold) => D.run(txt, { bold: !!bold, sizeHalfPt: TAMANHO });
  const linhas = [
    [cell(linha), cell(linha)],
    [cell(nomeAdv, true), cell(nomeEst, true)],
    [cell(`Advogado(a) — OAB/BA nº ${oabAdv}`), cell(`CPF nº ${dados.cpf ? T.formatCPF(dados.cpf) : BLANK}`)],
    [cell('ESCRITÓRIO', true), cell('ESTAGIÁRIO(A)', true)],
  ];
  if (estudante) {
    linhas.push([cell(' '), cell(' ')]);
    linhas.push([cell(' '), cell(' ')]);
    linhas.push([cell(linha), cell('')]);
    linhas.push([cell(ou(t.instNome, '__________________________'), true), cell('')]);
    linhas.push([cell(`Representante: ${ou(t.instRepresentante, '______________________')}`), cell('')]);
    linhas.push([cell('INSTITUIÇÃO DE ENSINO (interveniente-anuente)', true), cell('')]);
  }
  corpo.push(D.grade(linhas, { largurasCm: [8.2, 8.2] }).split('<w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr>').join('<w:pPr><w:keepNext/><w:spacing w:line="240" w:lineRule="auto"/></w:pPr>'));

  const nomeArquivo = `Termo de Estagio - ${(dados.nome || 'Estagiario').replace(/[^\w\- ]/g, '').trim() || 'Estagiario'}`;
  return { corpoXml: corpo.join(''), nomeArquivo, numero, titulo: NOMES[numero] };
}

module.exports = { sanitizar, gerarCorpoTermo, textoTemporalidadePadrao, numeroDoTermo, NOMES };
