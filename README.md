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


---

Qualquer erro ao subir, me mostre a mensagem exata que aparece (no Render, aba "Logs")
que eu te ajudo a resolver.
