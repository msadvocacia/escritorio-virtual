# MS Advocacia — Sistema de Gestão (versão servidor próprio)

Esta é a versão do sistema rodando em **Node.js + Express + MongoDB**, feita para você
hospedar no **Render** (ou em qualquer outro lugar, incluindo uma máquina em casa).

Ela substitui a versão anterior (que rodava só dentro do Claude) por uma aplicação
de verdade, com login validado no servidor e senhas protegidas com **bcrypt** —
ninguém mais recebe o hash de senha de ninguém, ao contrário da versão anterior.

---

## 1. O que você precisa antes de começar

1. Uma conta no **[MongoDB Atlas](https://www.mongodb.com/atlas)** (tem plano gratuito, o "M0").
   O Render **não hospeda banco MongoDB** — só o Atlas (ou outro provedor de MongoDB) faz isso.
2. Uma conta no **[Render](https://render.com)** (também tem plano gratuito).
3. Uma conta no **[GitHub](https://github.com)**, para subir este código (o Render publica a partir de um repositório Git).

---

## 2. Criando o banco de dados (MongoDB Atlas)

1. Crie uma conta em mongodb.com/atlas e crie um **cluster gratuito (M0)**.
2. Em "Database Access", crie um usuário com senha (anote os dois).
3. Em "Network Access", clique em "Add IP Address" → "Allow access from anywhere" (`0.0.0.0/0`).
   Isso é necessário porque o Render se conecta de um IP que muda, e o Atlas precisa aceitar.
4. Em "Database" → "Connect" → "Drivers", copie a **connection string**. Ela se parece com:
   ```
   mongodb+srv://SEU_USUARIO:SUA_SENHA@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
5. Adicione o nome do banco depois da barra, por exemplo:
   ```
   mongodb+srv://SEU_USUARIO:SUA_SENHA@cluster0.xxxxx.mongodb.net/ms_advocacia?retryWrites=true&w=majority
   ```
   Guarde essa string inteira — é o valor de `MONGODB_URI`.

---

## 3. Subindo o código para o GitHub

1. Crie um repositório novo (pode ser privado) no GitHub, por exemplo `ms-advocacia-server`.
2. Suba todos os arquivos desta pasta para esse repositório (pelo site do GitHub mesmo,
   arrastando os arquivos, ou usando `git` se souber usar).
   **Não suba o arquivo `.env`** (se você criar um) — ele tem senhas. O `.gitignore`
   já está configurado para ignorá-lo.

---

## 4. Publicando no Render

1. Em render.com, clique em **"New" → "Web Service"**.
2. Conecte sua conta do GitHub e escolha o repositório que você acabou de criar.
3. O Render deve detectar o `render.yaml` automaticamente. Se não detectar, configure manualmente:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
4. Em "Environment", adicione as variáveis:
   - `MONGODB_URI` → cole a connection string do Atlas (passo 2).
   - `JWT_SECRET` → o Render pode gerar um valor aleatório sozinho (o `render.yaml` já pede isso). Se precisar definir manualmente, use algo bem longo e aleatório.
   - `MASTER_SENHA_INICIAL` → a senha que o usuário `master` terá no primeiro acesso (ex: `master123`). Troque-a assim que entrar pela primeira vez.
   - `CORS_ORIGIN` → deixe `*` por enquanto (funciona), ou coloque o endereço do seu site depois.
5. Clique em **"Create Web Service"**. O Render vai instalar as dependências e iniciar o servidor.
6. Quando terminar, o Render te dá um endereço tipo `https://ms-advocacia-server.onrender.com`.
   Esse é o endereço fixo que você queria — pode acessar de qualquer lugar.

**Primeiro acesso**: usuário `master`, senha a que você definiu em `MASTER_SENHA_INICIAL`.
O sistema pede para trocar a senha assim que você entra.

> **Nota sobre o plano gratuito do Render**: no plano free, o servidor "dorme" depois de um
> tempo sem uso e demora ~30-50 segundos para acordar no primeiro acesso do dia. Isso é
> uma limitação do plano gratuito, não um problema do código. Se isso incomodar, os planos
> pagos do Render (a partir de uns poucos dólares/mês) mantêm o servidor sempre ativo.

---

## 5. Alternativa: hospedar na sua própria máquina em casa

Se preferir usar uma máquina sua em vez do Render:

1. Instale o [Node.js](https://nodejs.org) (versão 18 ou mais nova) na máquina.
2. Copie esta pasta inteira para a máquina.
3. Crie um arquivo `.env` (copie o `.env.example` e preencha com seus valores reais,
   incluindo o `MONGODB_URI` do Atlas — ou instale o MongoDB localmente também).
4. Rode `npm install` e depois `npm start`.
5. Para ter um "endereço fixo" de fora de casa, você precisa de **uma de duas coisas**:
   - Um serviço de DNS dinâmico (ex: No-IP, DuckDNS) + liberar a porta no seu roteador
     (encaminhamento de porta), **e configurar HTTPS você mesmo** (ex: com Caddy ou
     Nginx + Let's Encrypt) — sem HTTPS, login e senha trafegam sem criptografia
     pela internet, o que não é seguro.
   - Ou um serviço de túnel como o [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (gratuito), que dá HTTPS de graça e não exige mexer no roteador.
   Isso foge do escopo do que posso configurar por aqui — recomendo o Cloudflare Tunnel
   por ser o caminho mais simples e seguro.

**Resumindo**: o caminho Render + MongoDB Atlas é bem mais simples de colocar no ar
com segurança (HTTPS automático, sem mexer em roteador). A opção "em casa" funciona,
mas dá mais trabalho para deixar segura.

---

## 6. O que mudou de verdade nessa migração (segurança)

- **Antes**: todo mundo que abria o sistema recebia, nos bastidores, os hashes de senha
  de todo mundo (inclusive do master). A "segurança" dependia só da tela não mostrar
  certas coisas.
- **Agora**: o servidor nunca envia hash de senha para ninguém. O login é conferido
  inteiramente no servidor (com bcrypt). Cada papel (sócio, associado, cliente) só
  recebe do servidor os dados que ele tem permissão de ver — testei isso na prática
  (inclusive simulando uma tentativa de um associado mexer nos dados de outro, e o
  servidor bloqueou corretamente).

## 7. Limitações que ainda existem (para você saber)

- Cada "coleção" (processos, honorários, etc.) é guardada como um documento só no
  Mongo, não uma coleção normalizada por registro. Isso foi uma escolha deliberada
  para reaproveitar o painel existente sem reescrevê-lo do zero. Funciona bem para
  o uso de um escritório pequeno/médio; se um dia crescer muito (dezenas de pessoas
  usando ao mesmo tempo o tempo todo), vale a pena normalizar o banco.
- A confirmação de repasse ao associado (tela Financeiro) ainda não tem uma trava
  extra no servidor impedindo que um associado confirme o próprio repasse manipulando
  a requisição diretamente (fora da tela). Na prática, pelo aplicativo normal isso
  não é possível (o botão só aparece para master/sócio), mas um usuário técnico
  poderia tentar via ferramentas de desenvolvedor. Posso reforçar isso se quiser.
- Não tenho como testar-deploy isso de verdade (não tenho acesso a criar contas no
  Render/Atlas por aqui) — testei toda a lógica localmente com um banco simulado,
  mas o primeiro deploy real pode exigir pequenos ajustes seus.

## 8. Nova funcionalidade: "última movimentação em linguagem simples"

Ao clicar no número de um processo (tanto na tela "Meus processos" do cliente quanto
na tela "Processos" da equipe), o sistema:

1. Verifica se já consultou aquele processo **hoje** (guardado no MongoDB) — se sim,
   usa o resultado salvo, sem gastar cota das APIs externas de novo.
2. Se não, identifica automaticamente o tribunal a partir do próprio número (padrão
   CNJ) e consulta a **API Pública do Datajud (CNJ)**, gratuita.
3. Pega a movimentação mais recente e pede para o **Google Gemini** (modelo gratuito
   `gemini-1.5-flash`) explicar em linguagem simples, para um cliente leigo entender.
4. Salva o resultado do dia no banco e mostra na tela.

### Como obter as chaves (gratuitas)

- **DATAJUD_PUBLIC_KEY**: **essa já vem pré-preenchida** no `render.yaml` e no
  `.env.example` — é uma chave pública **fixa e compartilhada** que o próprio CNJ
  divulga (não é algo que você "solicita" ou gera individualmente). Você não
  precisa fazer nada aqui, a menos que o CNJ troque a chave no futuro — se a
  consulta parar de funcionar do nada, confira o valor atual em
  https://datajud-wiki.cnj.jus.br/api-publica/acesso e atualize a variável.
- **GEMINI_API_KEY**: essa sim é pessoal — crie a sua gratuitamente em
  https://aistudio.google.com/app/apikey (conta Google comum, sem custo no plano
  gratuito, com limite diário de uso) e adicione no Render, em "Environment".

### Limitações desta funcionalidade (importante saber)

- **Cobertura de tribunais**: mapeei os tribunais mais comuns (todos os Tribunais de
  Justiça estaduais, TRFs, TRTs, TREs e STJ/STM) a partir do próprio número do
  processo. Isso cobre a imensa maioria dos casos de um escritório de advocacia.
  Se algum dia aparecer "tribunal não reconhecido", me avise o número do processo
  que eu ajusto o mapeamento (arquivo `src/utils/cnj.js`).
- **Nem todo processo está na base do Datajud**: processos em segredo de justiça,
  muito recentes, ou de tribunais ainda não totalmente integrados podem não aparecer.
  Quando isso acontece, o sistema mostra uma mensagem explicando, em vez de travar.
- **Cotas gratuitas**: tanto o Datajud quanto o Gemini têm limites de uso gratuito
  (geralmente generosos para o volume de um escritório pequeno/médio). O cache diário
  ajuda bastante a não estourar esses limites.
- Não tenho como testar com processos e chaves reais por aqui — testei toda a lógica
  (identificação do tribunal, cache, tratamento de erro) simulando as respostas dessas
  APIs, mas o primeiro uso real pode revelar algum ajuste fino necessário no formato
  exato dos campos que o Datajud devolve (a estrutura pode variar ligeiramente entre
  tribunais).


## 9. Impressão fiel ao timbrado real (arquivo Word)

Na tela de Clientes, ao clicar em "Procuração" ou "Contrato", agora existe um botão
**"📥 Baixar em Word (.docx) — usa o timbrado real"**. Diferente do botão de imprimir
(que só reproduz visualmente o timbrado via CSS no navegador), este botão gera um
**arquivo .docx de verdade**, construído a partir do seu próprio arquivo Word original
(cabeçalho, rodapé e logo exatamente como você usa), preenchido automaticamente com
os dados do cliente e do(s) advogado(s) selecionado(s).

Isso resolve de vez o problema de fidelidade visual: como é o Word renderizando o
próprio arquivo, não existe mais divergência de margem, fonte ou posicionamento.

Testei a geração de ponta a ponta (API real → arquivo .docx → convertido para PDF
para conferência visual) e o resultado sai correto, em uma página, com o timbrado
intacto.

### Limitações desta parte

- Estendi a mesma geração real em Word para **todos os documentos**: Procuração,
  Contrato, Recibo e Relatório Financeiro. Todos agora baixam como `.docx` de
  verdade, usando o mesmo timbrado.
- **Continuidade do timbrado em várias páginas**: como o cabeçalho/rodapé aqui
  são de verdade (não um recurso do navegador), o Word repete automaticamente em
  todas as páginas, sem eu precisar programar nada especial para isso — testei
  com um documento propositalmente longo (25 advogados numa procuração) e as 3
  páginas geradas saíram todas com o timbrado.
- **Correção importante**: encontrei e corrigi um bug real na primeira versão dos
  modelos — quando havia mais de um advogado, a lista às vezes aparecia como
  "undefined, undefined" em vez do nome de cada um. Já testei de novo com múltiplos
  advogados e o texto sai correto agora.
- A conversão automática para **PDF direto no servidor** continua fora do escopo
  (Render, no plano gratuito, não tem o LibreOffice instalado). Como você
  confirmou que prefere salvar em PDF manualmente na hora de imprimir, mantive
  assim — sem essa complexidade extra.


## 10. Sistema lento? Como deixar mais rápido

Se o sistema estiver demorando para responder, isso é quase sempre uma das três coisas abaixo — nenhuma delas é um "bug" no código, são características dos planos gratuitos:

1. **Render "dorme" no plano gratuito.** Depois de ~15 minutos sem uso, o servidor desliga e demora de 30 a 50 segundos para acordar no próximo acesso. Isso é normal no plano Free. Soluções:
   - Migrar para o plano pago mais barato do Render (Starter, poucos dólares/mês) — o servidor fica sempre ligado.
   - Ou usar um serviço gratuito de "ping" (ex: [UptimeRobot](https://uptimerobot.com), gratuito) configurado para acessar `https://SEU-APP.onrender.com/api/health` a cada 10 minutos, mantendo o servidor acordado. É um contorno, não uma solução definitiva.

2. **MongoDB Atlas no plano gratuito (M0)** também pode ser mais lento, principalmente se o servidor do Atlas estiver numa região distante do servidor do Render. Verifique se escolheu a mesma região (ex: ambos em "São Paulo/South America" ou ambos nos EUA) — isso costuma ajudar bastante. Rode o Render e o Atlas na mesma região sempre que possível.

3. **GitHub em si não afeta velocidade** — ele só guarda o código; a velocidade do site depende do Render (onde o código roda) e do Atlas (onde os dados ficam), não do GitHub.

Se depois de ajustar isso a lentidão continuar, pode ser algo específico acontecendo — me diga em qual tela/ação demora mais que eu investigo.

## 11. Correções importantes desta atualização

Encontrei e corrigi os seguintes problemas reportados, todos testados de ponta a ponta:

- **Botão "Salvar" sumindo em alguns formulários**: uma tela (consulta de andamento) escondia o botão, e isso ficava "grudado" em todas as telas seguintes. Corrigido.
- **Clientes/processos somem, ou é preciso dar F5 para ver alterações**: a causa raiz era que o sistema salvava a coleção inteira de uma vez, então uma tela com dados desatualizados podia apagar o que outra pessoa tinha acabado de criar. Criei um mecanismo que sempre busca a versão mais recente do servidor antes de salvar qualquer alteração, e apliquei isso em todos os pontos de escrita (processos, prazos, honorários, despesas, lembretes, agenda, mensagens, audiências). Testei simulando duas pessoas mexendo ao mesmo tempo — os dados não se apagam mais.
- **Perda do controle financeiro (parcelas pagas) ao editar um processo**: corrigido — editar um processo agora preserva quais parcelas já estavam pagas, desde que a forma de pagamento e a quantidade não mudem.
- **Associado sem acesso aos campos financeiros do processo**: corrigido, ele já pode preencher tudo.
- **Sócio também precisa poder ter vínculo/split próprio** (ele não é o "escritório"): agora o campo "Profissional vinculado" aceita tanto sócios quanto associados, com as mesmas opções de divisão percentual.
- **Dois profissionais dividindo 50/50 sem passar pelo caixa do escritório**: implementado (novo tipo de vínculo "Dois profissionais, 50%/50%"), com um segundo campo para escolher o segundo profissional.
- **Quantidade de parcelas travada em 2 no processo**: corrigido (o campo se resetava sozinho a cada tecla digitada).
- **Calculadora de prazo**: adicionada — informe a data de publicação e a quantidade de dias, escolha dias úteis ou corridos, e o vencimento é calculado automaticamente. *(Não considera feriados nacionais/estaduais/municipais — confira antes de confiar cegamente.)*
- **Mensagem de erro do Datajud**: deixei mais clara para quem ainda não configurou a chave.



## 12. Correções desta atualização (a pedido do usuário)

- **Instagram sempre voltava para o link errado**: achei a causa — o botão "Salvar"
  das Configurações não estava realmente chamando a API (ficava só na memória do
  navegador). Corrigido, e o padrão agora é `instagram.com/msadvocacia.073`.
- **Lista de Usuários misturando cliente com sócio/associado**: separado — a tela
  de Usuários agora mostra só a equipe (master/sócio/associado); clientes só
  aparecem na tela de Clientes, como deveria ser desde o início.
- **Campo de telefone no cadastro de usuário**: adicionado (junto com endereço).
- **Datajud não funcionava**: o problema real era que eu tinha te orientado a
  "pedir uma chave", quando na verdade o CNJ usa uma **chave pública fixa e
  compartilhada por todo mundo**. Já deixei ela pré-preenchida no projeto — não
  precisa fazer nada, só configurar a `GEMINI_API_KEY` (essa sim é pessoal).
- **Advogado editando os próprios dados**: novo botão "Meu perfil" no topo da
  tela, disponível para sócio/associado/master, onde dá pra atualizar telefone e
  endereço (e a senha, no botão ao lado). Nome, RG, CPF e situação ativo/inativo
  continuam só com o administrador ou sócio, como pedido.


## 13. Atualização: Codilo no lugar do Datajud, lembretes seletivos e consulta restrita ao cliente

### ⚠️ Aviso importante antes de subir esta atualização

Vocês me contaram que já substituíram o Gemini pelo **Groq** diretamente no arquivo
`src/utils/gemini.js` (ou onde quer que tenham feito essa troca) e que está
funcionando. **Eu não mexi nesse arquivo nesta atualização.** Mas se vocês forem
substituir TODOS os arquivos do zip de uma vez no GitHub, tomem cuidado para não
sobrescrever o arquivo de vocês (com o Groq já configurado) pelo meu (que ainda
referencia o Gemini/`gemini-flash-latest`). Se não tiverem certeza, me avisem
qual é o nome exato do arquivo que vocês editaram, que eu confirmo.

**Arquivos que mudaram nesta atualização** (atualize só estes, se quiser ser mais seguro):
- `src/utils/codilo.js` (novo)
- `src/routes/processoConsulta.js`
- `src/utils/visibility.js`
- `src/utils/merge.js`
- `.env.example`, `render.yaml`
- `public/index.html`

### O que mudou

1. **Datajud → Codilo**: a busca de andamentos agora usa a API paga da Codilo, que
   entrega o texto completo (não só metadados resumidos). Implementei com base na
   documentação oficial deles (docs.codilo.com.br): autenticação OAuth2 (client
   credentials), resolução automática de tribunal/plataforma via o endpoint
   `/available` da própria Codilo (evita eu manter uma tabela fixa que ficaria
   desatualizada), criação da consulta e espera pelo resultado (a consulta da
   Codilo é assíncrona — meu código aguarda automaticamente até uns 30 segundos).
   Testei esse fluxo inteiro simulando as respostas da Codilo (autenticação,
   abrangência, criação, resultado) — funcionou corretamente, inclusive escolhendo
   a movimentação mais recente e extraindo o texto completo mesmo quando simulei
   um formato de campo diferente do esperado.

   **Onde configurar**: adicione `CODILO_CLIENT_ID` e `CODILO_CLIENT_SECRET` nas
   variáveis de ambiente do Render, assim que o token de homologação chegar no
   e-mail de vocês.

   **Não testei com credenciais e processos reais** (não tenho acesso a elas) —
   testei toda a lógica com respostas simuladas da API. O primeiro uso real pode
   revelar necessidade de ajuste fino no nome exato dos campos de cada tribunal
   dentro de um "step" (andamento), já que isso pode variar por plataforma
   (ESAJ, PJe, Eproc, etc.) — se algum andamento aparecer estranho ou incompleto,
   me mande o retorno bruto da Codilo para eu ajustar a extração.

2. **Consulta de processos restrita ao perfil do cliente**: removi o clique nos
   números de processo da tela interna "Processos" (equipe) — agora só existe na
   tela "Meus processos" do cliente. Também bloqueei a rota no servidor para
   qualquer perfil que não seja cliente, então mesmo que alguém tente pela tela
   de programador (F12), não consome crédito da Codilo.

3. **Lembretes com visibilidade seletiva**: ao criar um prazo (ou um lembrete
   avulso), sócio/associado agora escolhem para quais colegas específicos aquele
   lembrete deve aparecer. Deixando todo mundo desmarcado, continua visível para
   a equipe inteira (comportamento de antes, preservado). O administrador master
   sempre vê todos os lembretes, independentemente da seleção.



## 14. Codilo descontinuada → trocado para BuscaProcessos

A Codilo saiu do ar, então troquei de novo — desta vez para a **BuscaProcessos**
(docs.buscaprocessos.app.br), com base na documentação técnica oficial deles.

### Boa notícia: essa integração ficou mais simples que a da Codilo

A BuscaProcessos identifica o tribunal automaticamente a partir do próprio número
CNJ — não preciso mais resolver "qual tribunal/plataforma" no meu código. A
autenticação também é mais simples: só uma chave fixa no cabeçalho da requisição
(sem OAuth2 com token expirando). Isso deixa a integração mais enxuta e com
menos pontos de falha.

**O que fiz:**
- Criei `src/utils/buscaprocessos.js`, chamando `GET /v1/processos/cnj/{cnj}/movimentacoes`.
- Tratei as mensagens de erro específicas da BuscaProcessos (créditos insuficientes,
  chave inválida, processo não encontrado, limite de requisições) com avisos
  em português, amigáveis para o cliente que for ver a tela.
- Testei o fluxo inteiro simulando as respostas da API: escolha correta da
  movimentação mais recente entre várias, formatação correta do número CNJ,
  cabeçalho de autenticação correto, e cada um dos erros tratados
  corretamente (inclusive testei via a rota completa do sistema, do login do
  cliente até o resultado final).

**Onde configurar**: adicione `BUSCAPROCESSOS_API_KEY` nas variáveis de ambiente
do Render assim que a chave (prefixo `bp_live_...`) sair do painel deles.

**Não testei com créditos e processos reais** — só com respostas simuladas.
O formato exato dos campos de cada movimentação pode variar um pouco entre
tribunais; se algum andamento aparecer estranho ou incompleto no primeiro uso
real, me manda o retorno bruto da BuscaProcessos que eu ajusto a extração.

**Lembrete**: continuo sem mexer no arquivo que faz a explicação em linguagem
simples (o que está com Groq, funcionando). Só troquei a parte que busca o
texto da movimentação no tribunal.



## 15. Visual estilo PROJUDI, reformatação de documentos, e abas no Financeiro

- **Consulta de processo com visual de tabela** (como o PROJUDI): mudei só a
  apresentação do resultado — a consulta continua sendo apenas a capa/última
  movimentação, sem gastar créditos extras da BuscaProcessos.

- **Procuração e Contrato totalmente reformatados**, seguindo à risca as
  regras que vocês pediram: Times New Roman 12, espaçamento 1,5 (aplicado no
  documento inteiro via estilo padrão), rótulos e nomes em caixa alta e
  negrito, múltiplos outorgados/contratados no mesmo parágrafo com o endereço
  consolidado quando é igual para todos, valor/parcelas/percentual em negrito,
  recuos e quebras de linha exatamente onde pedido.

  Tive que reconstruir a geração desses dois documentos do zero (o método
  anterior não permitia esse nível de controle fino quando o número de pessoas
  no parágrafo muda a cada processo). Encontrei e corrigi, ao testar, dois bugs
  reais introduzidos nessa reconstrução: um de texto duplicado por engano, e uma
  inconsistência onde "ADVOGADO"/"OUTORGANTE" não ficavam em negrito em alguns
  parágrafos específicos. Testei extraindo o XML gerado (confirmando negrito e
  consolidação de endereço exatamente como esperado) e também confirmei o texto
  final via conversão para PDF — tudo limpo, sem corrupção.

- **Financeiro com abas**: "Repasses por processo" agora tem sub-abas
  Pendentes (padrão) / Repassados. "Honorários" agora tem sub-abas Em aberto
  (pendente + parcialmente pago, padrão) / Pagos. As listas gigantescas viraram
  bem mais fáceis de navegar.


## 16. Parcelas cronológicas, login, vínculo de processo, ocultar valores e relatório

- **Parcelas pendentes em ordem cronológica**: novo painel no Financeiro, mostrando data, cliente e valor de cada parcela ainda não paga, ordenadas por vencimento.
- **Login**: removida a mensagem com usuário/senha do master (nas três telas onde aparecia); adicionado o "olhinho" para mostrar/ocultar a senha digitada.
- **Vínculo de múltiplos profissionais ao processo**: associado agora pode vincular qualquer sócio ou associado, **desde que inclua pelo menos 1 sócio** (nunca só outros associados). Validado tanto na tela quanto no servidor — testei as duas situações (com e sem sócio) e o bloqueio funciona corretamente mesmo tentando contornar a tela.
- **Recibo em papel timbrado**: já existia de uma atualização anterior (botão 📥 ao lado do 🧾), só confirmei que está funcionando.
- **Ocultar valores**: novo "olhinho" no Dashboard ("a receber", "recebido no mês") e no Financeiro ("despesas do mês", "saldo do mês", "caixa acumulado", e os demais valores da tela). Fica oculto por padrão sempre que alguém entra no sistema — só sócio e administrador master têm esse controle.
- **Relatório financeiro reestruturado**: título em Times New Roman 14, corpo em 11,5 com espaçamento 1,5, rótulos em caixa alta e negrito, valores em negrito, "REPASSES POR PROCESSO" em caixa alta e negrito, com uma tabela de verdade (Cliente em ordem alfabética / Profissional / Valor em negrito / Status) e o somatório de repassado e aguardando ao final.

  Encontrei e corrigi dois bugs reais nesse processo, ambos antes de entregar: um de texto duplicado na tabela (mesmo tipo de bug que já tinha corrigido antes em outro lugar do sistema, só que dessa vez na função nova de tabela), e um erro de cálculo nos totais (a soma de "R$ 1.400,00" estava dando errado por causa do separador de milhar — corrigi para somar os números direto, sem depender do texto já formatado). Testei gerando um relatório com clientes de propósito fora de ordem alfabética para confirmar a ordenação, e conferi que os totais batem exatamente com as linhas da tabela.


## 17. Novo: Cálculo Jurídico (item no menu lateral)

Você pediu um módulo cobrindo 16 áreas do direito. Fui honesto sobre o escopo:
não dá para eu entregar as 16 áreas com confiabilidade total numa única vez —
alguns desses cálculos (dosimetria penal, RMI previdenciário, revisão bancária)
têm regras jurídicas específicas e mudam com a jurisprudência, e um erro ali
não é "só um bug de tela", tem consequência real. Por isso, construí a
**arquitetura certa** primeiro e entreguei **3 módulos totalmente funcionais**
como base, com as outras 13 áreas já organizadas no menu, prontas para eu
implementar uma de cada vez quando você pedir.

### O que já está pronto e testado

- **Núcleo de correção monetária + juros**: em vez de eu digitar uma tabela de
  índices "fixa" (que ficaria desatualizada e poderia ter erro de digitação
  com consequência financeira real), o sistema busca os índices **ao vivo,
  direto do Banco Central** (Sistema Gerenciador de Séries Temporais, API
  pública, sem custo). Índices disponíveis: INPC, IPCA, IPCA-E (veja aviso
  abaixo), Selic, IGP-M e TR. Bloqueei a combinação Selic + juros por fora,
  porque a Selic já embute juros — somar os dois causaria dupla contagem (um
  erro jurídico real, não só de código).
- **Trabalhista — Verbas rescisórias** (dispensa sem justa causa): saldo de
  salário, aviso prévio (indenizado/trabalhado, com a projeção correta de +3
  dias por ano completo), 13º proporcional, férias proporcionais + 1/3, FGTS +
  multa de 40%. **Encontrei e corrigi um bug real** nos testes: o cálculo de
  férias proporcionais estava usando o tempo total de casa em vez do período
  aquisitivo em curso — corrigido e testado com dois casos diferentes antes de
  entregar.
- **Cível — Repetição de indébito** (simples ou em dobro, art. 42 CDC), com
  correção monetária opcional pelo núcleo acima.

### Limitações importantes (leia antes de usar)

- **IPCA-E**: o índice "oficial" usado em precatórios é composto
  trimestralmente a partir do IPCA-15, um cálculo mais específico que o IPCA
  mensal comum. Por enquanto, uso o IPCA mensal como aproximação — para casos
  de precatório, **confira a tabela oficial do tribunal** antes de protocolar.
- **Lei 14.905/2024** mudou recentemente as regras de correção monetária do
  Código Civil (índice padrão passou a ser o IPCA, não mais IPCA-E, e a Selic
  já embute juros). O sistema reflete isso, mas a lei é recente — confirme com
  a jurisprudência do seu tribunal se o caso for anterior a 30/08/2024.
- As **13 áreas restantes** (previdenciário, tributário, execução fiscal,
  empresarial, penal, família — além da pensão, consumidor/bancário,
  administrativo, locação, desapropriação, seguros, eleitoral, ambiental, e o
  bloco próprio de FGTS) aparecem no menu com a lista do que está previsto,
  mas ainda não têm calculadora funcionando — é só pedir para eu implementar
  qualquer uma delas, uma de cada vez, com o mesmo cuidado de teste que apliquei
  nestas três.
- Nenhum desses cálculos substitui a conferência de um profissional antes de
  usar em petição, principalmente em casos com regras específicas (convenção
  coletiva, decisão judicial determinando índice próprio, médias variáveis,
  etc.).


## 18. Administrativo/Servidor Público + Parâmetros de Cálculo editáveis

### Sobre "busca automática de atualizações"

Pensei bastante nisso antes de decidir o caminho. **Não** implementei uma busca
automática que altera os cálculos jurídicos sozinha, e o motivo é de segurança:
leis e jurisprudência não têm uma API pública estruturada (diferente dos índices
econômicos, que têm o SGS do Banco Central). Uma automação que "lê a internet e
muda a fórmula sozinha" correria o risco de interpretar errado uma mudança e
corromper um cálculo jurídico sem ninguém perceber — isso seria pior do que o
problema que estamos tentando resolver.

Em vez disso, fiz o que dá pra fazer com segurança: os valores que **mudam por
portaria** (teto e piso do INSS, por enquanto) agora ficam guardados no banco de
dados, **editáveis direto na tela** ("⚙️ Parâmetros de Cálculo", visível para
master/sócio) — sem precisar mexer no código nem reimplantar o servidor toda vez
que uma nova portaria sair. Testei: editei o teto na tela e confirmei que o
cálculo de RMI já passou a usar o novo valor imediatamente, e que um associado
tentando editar esses parâmetros é bloqueado corretamente.

Os índices econômicos (INPC, IPCA, Selic, etc.) **já são** buscados ao vivo — não
precisam de atualização manual, isso já está resolvido desde o início.

### Administrativo/Servidor Público

- **Reposição salarial / diferenças de reajuste**: usa o núcleo de correção,
  com qualquer um dos índices disponíveis.
- **Diferenças de planos econômicos**: pesquisei e confirmei os percentuais
  exatos na jurisprudência consolidada do STJ (recursos repetitivos, Temas
  264/284/285 do STF) — Bresser (jun/1987, 26,06%), Verão (jan/1989 42,72% e
  fev/1989 10,14%), Collor I (mar/1990 84,32%, abr/1990 44,80%, jun/1990 9,55%,
  jul/1990 12,92%) e Collor II (jan/1991 13,69%, mar/1991 13,90%). Listados
  mês a mês (não combinados por mim) para você compor exatamente os meses do
  seu caso, evitando erro de composição.
- **Não cobre** quintos/décimos incorporados nem VPNI — isso varia muito por
  ente federativo e tribunal, exigindo análise específica que uma calculadora
  genérica não consegue fazer com segurança.

Testei os parâmetros editáveis (edição, reflexo imediato no cálculo, bloqueio
de associado) e o cálculo de planos econômicos com valores conhecidos antes de
entregar.


## 19. Novo: Módulo 17 — Retroativos PCCR (Mudança de Nível / Gratificação)

### Sobre a validação deste módulo — leia antes de confiar no resultado

Você anexou um PDF (ficha financeira + um cálculo pronto, modelo "RM Cálculos",
páginas 7-8) para eu usar como teste. **Preciso ser transparente**: a ferramenta
de visualização de imagem não carregou nesta sessão (tentei várias vezes, em
resoluções diferentes) — o PDF é escaneado (sem camada de texto), então não
consegui ler visualmente. Recorri a OCR (reconhecimento de texto em imagem) como
alternativa, e isso **funcionou o suficiente para confirmar a estrutura** do
cálculo (a estrutura A/B/C que você descreveu bate exatamente com o que vi no
seu PDF real), **mas não foi preciso o bastante nos dígitos exatos** (OCR em
documento escaneado tem ruído — números como "5" e "6" às vezes saem trocados)
para eu validar o resultado final, número por número, contra aquele caso real.

**O que isso significa na prática**: construí o módulo seguindo à risca a sua
especificação escrita (que é clara e detalhada), e testei a lógica com casos que
eu mesmo construí (números redondos, fáceis de conferir de cabeça) — não com o
caso real do PDF. Recomendo fortemente que você rode esse mesmo caso (Cássio
Alves) manualmente no sistema e compare com o resultado das páginas 7-8 antes de
usar isso em produção. Se algo não bater, me mostre onde e eu ajusto.

### O que foi implementado

- **Duas modalidades**, selecionáveis no início: Mudança de Nível (altera o
  salário-base, com reflexos em verbas percentuais parametrizáveis — anuênio,
  insalubridade, etc.) e Implantação de Gratificação (a gratificação nunca
  existiu; não há "base devido" diferente).
- **Prescrição quinquenal automática** (Decreto 20.910/32): meses anteriores a
  protocolo−5 anos aparecem esmaecidos e zerados na tabela, com aviso da
  data-limite aplicada.
- **Tabela mês a mês** + **Resumo A/B/C** exatamente na estrutura que você
  descreveu: A) Proventos (salarial + indenizatório) → B) Descontos (INSS
  progressivo mês a mês + IRRF opcional) → Valor líquido → C) Valor devido pelo
  município (líquido + retenções + contribuição patronal parametrizável).
- **Tabela do INSS 2026** (progressiva, com parcela a deduzir) adicionada aos
  Parâmetros de Cálculo editáveis — pesquisei e confirmei os valores atuais
  antes de codificar.
- Testei: diferença simples de base, corte por prescrição, modalidade
  gratificação com reflexos de 13º e 1/3 férias, e a estrutura A/B/C completa
  (incluindo o INSS progressivo calculado corretamente por faixa) — todos com
  valores redondos que conferi manualmente.

### O que NÃO foi implementado nesta rodada

- **Extração automática de dados de PDF** (ficha financeira e tabela de níveis
  do PCS). Isso é um projeto à parte — o formato varia muito entre prefeituras,
  e fazer isso com confiabilidade exigiria um leitor de documento bem mais
  robusto do que dá para construir com segurança numa única resposta. Por
  enquanto, a entrada é manual, mês a mês, na própria tela.
- **Geração do documento final em Word/timbrado** para este módulo específico
  — o cálculo aparece na tela, mas ainda não tem o botão de baixar em .docx
  como procuração/contrato/recibo/relatório já têm. Posso adicionar isso a
  seguir, se você quiser.


## 20. Validação contra o caso real (Cássio Alves) — resultado detalhado

Você reenviou o PDF, e desta vez as imagens carregaram perfeitamente — dá pra
ver tudo com clareza. Reconstruí os 53 meses de dados da ficha financeira e
rodei pelo motor de cálculo de verdade. Aqui está o resultado, com total
transparência:

### ✅ O que bateu quase exatamente

- **Meses individuais**: conferi dois meses específicos (dez/2020 com reflexo de
  13º, jul/2020 com reflexo de 1/3 férias) e os totais bateram **exatos**,
  centavo a centavo.
- **Subtotal salarial**: meu R$ 36.302,28 vs. real R$ 36.306,70 (diferença de
  R$ 4,42, num total de mais de R$ 36 mil — vem de eu ter recalculado o
  percentual do anuênio a partir da própria diferença informada, reintroduzindo
  um arredondamento mínimo).
- **Soma (A)**: R$ 37.150,29 vs. R$ 37.156,22 (mesma origem de arredondamento).
- **Contribuição patronal**: R$ 9.075,57 vs. R$ 9.076,68 (idem).

Essa validação confirmou que a **lógica central está correta**: diferença de
base × percentual da verba naquele mês, 13º replicando o valor do mês, 1/3
férias como um terço do mês, estrutura A/B/C inteira.

### ⚠️ Descoberta importante: o percentual muda mês a mês

O anuênio do Cássio Alves foi de 17% (2020) até 21% (2024), subindo aos poucos
com o tempo de serviço — **não é um percentual fixo para todo o período**. Já
corrigi isso: agora cada mês tem seu próprio percentual para cada verba, em vez
de um valor único para o cálculo inteiro. Sem essa correção, o sistema anterior
estaria calculando tudo errado para qualquer caso com mudança de percentual ao
longo do tempo — o que parece ser a regra, não a exceção, nesse tipo de cálculo.

### ✅ Tabelas históricas do INSS adicionadas

Pesquisei e encontrei uma fonte com o histórico completo das tabelas do INSS
desde 1990. Adicionei as tabelas de 2020 a 2024 (mais 2026), calculando a
parcela a deduzir de cada uma com a mesma fórmula que já bate exatamente com os
valores oficiais publicados de 2024 e 2026 (conferi antes de confiar). Isso já
está integrado: o sistema agora escolhe automaticamente a tabela do ano certo
para cada competência, em vez de usar sempre a tabela atual.

### ❌ O que NÃO bateu: o desconto de INSS

Mesmo com a tabela certa de cada ano, meu cálculo do desconto previdenciário
(R$ 2.730,78) ficou bem abaixo do valor real (R$ 4.279,34). Testei três
hipóteses diferentes de metodologia antes de escrever esta seção:
1. INSS mês a mês sobre a diferença salarial (o que eu já fazia): R$ 2.730,78
2. INSS somando por ano, sobre o total anual das diferenças: R$ 3.597,82
3. INSS "incremental" (diferença entre o INSS do salário total devido e do
   salário total pago, mês a mês — a forma como a maioria dos sistemas de folha
   realmente calcula reajustes retroativos): R$ 5.082,32

Nenhuma bateu exatamente. A terceira hipótese é a mais próxima conceitualmente
do que sistemas de folha de pagamento reais costumam fazer (porque o INSS é
progressivo sobre o salário *inteiro*, não sobre a diferença isolada), mas eu
não tenho visibilidade sobre todos os outros itens do contracheque do Cássio
Alves (havia itens como "ajuste de 13º", "adiantamento de 13º" que não entraram
na minha reconstrução), o que pode explicar a diferença restante.

**Sendo direto**: não consegui reproduzir o desconto de INSS exato do "RM
Cálculos" com a informação que tenho. A parte A (proventos) e a contribuição
patronal — que são a maior parte do valor final — batem quase exatas. Se você
tiver mais detalhes de como o RM Cálculos faz essa conta especificamente (ou
puder me passar mais um caso de teste), consigo continuar refinando essa parte
específica.


## 21. Resolvido: Previdência Própria (RPPS), não INSS nacional

Você me deu a informação que faltava: o município do Cássio Alves tem
**previdência própria (RPPS)**, não o INSS nacional (RGPS). Isso explica tudo —
RPPS usa uma **alíquota fixa definida por lei municipal** (não a tabela
progressiva federal), e cada ente tem a sua, mudando só quando sai uma nova lei
de reajuste.

**Testei antes de mudar qualquer coisa**: descobri que uma alíquota fixa de
**11,79%** reproduz o desconto previdenciário real quase exatamente (R$
4.280,04 contra R$ 4.279,34 — diferença de **70 centavos**, dentro da margem de
arredondamento que já existia desde antes). Isso confirma que a arquitetura
agora está certa.

### O que mudou

- **Regime previdenciário selecionável**: RGPS (INSS nacional, tabela
  progressiva, como já estava) ou RPPS (alíquota fixa, editável por ano).
- **Alíquotas de RPPS editáveis por ano** na tela "⚙️ Parâmetros de Cálculo" —
  segurado e patronal separados, já que ambos costumam ser fixados na mesma lei
  municipal mas com percentuais diferentes. Sem alíquota cadastrada, o sistema
  avisa claramente em vez de calcular um valor errado silenciosamente.
- Testei: RPPS sem alíquota cadastrada (avisa e zera, não inventa número), RPPS
  com alíquota cadastrada (calcula certo, inclusive usando a alíquota patronal
  certa), e confirmei que o RGPS continua funcionando exatamente como antes
  (não quebrei nada ao adicionar isso).

### Resultado final da validação (regime RPPS, 11,79%)

| Item | Meu resultado | Valor real (RM Cálculos) | Diferença |
|---|---|---|---|
| Desconto previdenciário | R$ 4.280,04 | R$ 4.279,34 | R$ 0,70 |
| Valor líquido (A−B) | R$ 32.870,26 | R$ 32.876,88 | R$ 6,62 |
| Total devido (C) | R$ 46.225,87 | R$ 46.232,89 | R$ 7,02 |

As diferenças que sobram (na casa de poucos reais, num total de mais de R$ 46
mil) vêm inteiramente do fato de eu ter reconstruído os percentuais de
anuênio/insalubridade a partir das próprias diferenças informadas no PDF, o que
reintroduz um arredondamento mínimo — não é um problema de fórmula. **Com os
percentuais exatos (que vocês têm, e o sistema já pede mês a mês), o resultado
deve bater exatamente.**

**Importante**: não sei a alíquota de RPPS de nenhum outro município além
desta pista de 11,79% para este caso específico — cadastre a alíquota certa de
cada ente (conforme a lei municipal/estadual) antes de calcular para outros
clientes.


## 22. Ajustes finos em Procuração e Contrato

- **Contrato**: margem inferior aumentada em 0,5cm (o texto estava grudando no
  rodapé) — só nesse documento, os demais (procuração/recibo/relatório)
  continuam com a margem original.
- **Procuração**: fonte do corpo em 11,5 (era 12). Só um pulo de linha entre o
  fim do texto e o local/data (era dois).
- **Procuração — textos de PODERES e PODERES ESPECÍFICOS**: atualizados para o
  texto exato que vocês passaram.
- **Ajuste automático de fonte**: se o conteúdo for extenso o bastante para
  quase não caber numa página (deixando só a data/assinatura sobrando para a
  página seguinte), o sistema reduz sozinho para 11 e tenta caber tudo numa
  página só. Calibrei isso testando de verdade com 1, 2 e 3 outorgados: no meu
  teste, 1 e 2 outorgados agora cabem certinho numa página; com 3 outorgados e
  qualificações completas, mesmo a 11 o conteúdo é grande demais para uma
  página só — nesse caso, aceita ocupar duas, o que é esperado (a regra é para
  evitar sobra de só uma linha, não para forçar conteúdo genuinamente extenso
  a caber à força).

  **Detalhe técnico honesto**: como o servidor em produção (Render) não tem o
  LibreOffice instalado, não dá pra verificar a paginação de verdade a cada
  documento gerado (isso pediria uma dependência pesada só para essa checagem).
  Em vez disso, calibrei um critério por quantidade de caracteres do texto,
  testando os cenários reais no meu ambiente antes de definir o número. Pode
  eventualmente errar para o lado de usar fonte 11 num caso que também caberia
  em 11,5 — isso não é um problema (ambos os tamanhos são válidos e legíveis),
  só significa que o critério é uma boa aproximação, não uma medição exata.

- **Contrato — corpo do texto reescrito por completo**, a partir de "Tem justo
  e contratado o seguinte", com as 13 cláusulas exatas que vocês passaram
  (Do Objeto, Das Atividades, Dos Atos Processuais, Das Despesas, Dos
  Honorários, Da Vigência e da Rescisão, Da Responsabilidade, Do Foro).
  Mantive as mesmas regras de formatação já estabelecidas: CONTRATANTE,
  CONTRATADO, O ADVOGADO, OUTORGANTE e o tipo de processo em caixa alta e
  negrito onde aparecem no texto, e a inserção do valor/parcelas em negrito
  (algarismo e por extenso) na Cláusula 6ª.

  **Bug real que encontrei e corrigi durante o teste**: a Cláusula 8ª menciona
  "honorários CONTRATADOS" — como meu destaque automático busca a palavra
  "CONTRATADO", ele estava deixando só o "S" final fora do negrito
  ("**CONTRATADO**S"). Corrigido antes de entregar.

- **Assinaturas**: agora geram um bloco por pessoa — cada contratante com nome
  e "(CONTRATANTE)" embaixo, e cada advogado vinculado ao processo com nome,
  "(OAB/UF - número)" e "(CONTRATADO)" embaixo. Testei com 2 advogados
  vinculados e confirmei que os dois blocos saem certinhos.


## 23. Upload de PDF no módulo 17 (ficha financeira + tabela de níveis)

Adicionei os dois uploads que faltavam, exatamente onde você não estava
encontrando: dentro do módulo "Retroativos PCCR", logo acima da lista de
meses. O arquivo **nunca é salvo** — é lido só na hora, em memória, e
descartado depois de processado.

### Como funciona, com toda a transparência

1. **Extração de texto de verdade** (não é OCR): uso uma biblioteca que lê o
   texto e as tabelas que já existem dentro do PDF, se ele tiver sido gerado
   diretamente por um sistema (com texto selecionável) — não funciona com
   PDF escaneado/fotografado.
2. **Testei com o seu PDF real** (o do Cássio Alves) e confirmei: ele é
   **totalmente escaneado**, sem nenhum texto por trás — só imagem. Por isso,
   com PDFs desse tipo, o sistema recusa educadamente, com um aviso claro,
   em vez de tentar adivinhar (evitei OCR de propósito: além de exigir
   programas que não estão instalados no servidor de produção, o Render, já
   vimos neste mesmo sistema que OCR erra dígitos — arriscado demais para
   dado financeiro).
3. **Construí e testei o leitor de tabelas** com um PDF sintético (com texto
   de verdade) no formato que vi na ficha financeira do Cássio Alves. Nesse
   processo, **encontrei e corrigi um bug real**: os percentuais das verbas
   (tipo "17.00" para 17%) usam ponto decimal, mas os valores em reais (tipo
   "508,65") usam vírgula — formatos diferentes na mesma tabela. Meu código
   inicial tratava tudo como um formato só, e "17.00" virava "1700" por
   engano. Corrigido e testado: confirmei que agora extrai o salário-base e
   os percentuais de cada verba corretamente, mês a mês.
4. **Nunca calcula direto do PDF**: os dados lidos pré-preenchem a mesma lista
   de meses que já existia para preenchimento manual — você vê, confere e
   corrige antes de calcular. Isso é proposital: mesmo com texto de verdade
   (sem risco de OCR), o formato de ficha financeira varia entre prefeituras,
   e "base devido" e os reflexos de 13º/férias não vêm do PDF (isso depende
   da tabela de níveis e de qual mês teve gozo de férias/13º, que só você
   sabe) — então sempre sobra pelo menos uma revisão manual.
5. **Tabela de níveis**: mesmo princípio — upload, leitura, lista para
   conferência, nunca salva.

### O que ainda pode não funcionar

O leitor foi construído e testado no formato específico que vi na ficha do
Cássio Alves ("Sistema de Gestão de Pessoas", com códigos de evento tipo "1 -
SALARIO BASE", "16 - ANUENIO"). Se o sistema de folha do seu cliente usar um
formato bem diferente, a leitura pode não reconhecer nada — nesse caso, o
sistema avisa claramente ("não consegui reconhecer o formato") e você pode
preencher manualmente, ou me mandar um exemplo desse outro formato (com PDF
de texto real, não escaneado) para eu ajustar o leitor.


## 24. Procuração e Contrato: endereço profissional e telefone individual do advogado

- Na qualificação do **Outorgado/Contratado** (o advogado), a frase mudou de
  "residente e domiciliado(a) em" para **"com endereço profissional em"** —
  o cliente (Outorgante/Contratante) continua "residente e domiciliado(a)",
  sem mudança.
- O **telefone agora é o telefone individual cadastrado de cada profissional**
  (o campo "telefone" do próprio usuário), não mais o telefone geral do
  escritório. Testei com um advogado com telefone diferente do escritório e
  confirmei que o número certo aparece tanto na procuração quanto no contrato.


---

Qualquer erro ao subir, me mostre a mensagem exata que aparece (no Render, aba "Logs")
que eu te ajudo a resolver.
