# Implantação na Locaweb (Cloud Server / VPS)

Este guia é para quando o Render não é uma opção (por causa do bloqueio
geográfico do DJEN) e a decisão foi hospedar num servidor com IP brasileiro
de verdade — o que **resolve o bloqueio do DJEN sem precisar de nenhum
proxy**, já que o servidor inteiro passa a sair pela internet brasileira.

**Diferença importante em relação ao Render**: lá era só conectar o
repositório e ele publicava sozinho a cada atualização. Aqui é um servidor
Linux de verdade — você (ou alguém de TI, ou o suporte da Locaweb) precisa
rodar alguns comandos por SSH. Preparei tudo para ser o mais simples
possível: copiar e colar, um passo de cada vez.

O banco de dados (MongoDB Atlas) **não muda** — continua exatamente onde
está hoje, é um serviço à parte que não depende de onde a aplicação roda.

---

## Passo 1 — Contratar o servidor certo na Locaweb

Procure por **"Cloud Server"** (às vezes chamado de "VPS Cloud") no site da
Locaweb — não é a hospedagem de site comum (aquela é para WordPress/PHP e
não roda esse sistema direito).

Configuração mínima recomendada:
- Sistema operacional: **Ubuntu 22.04 LTS** (ou mais recente)
- 2 GB de RAM (1 GB pode funcionar, mas 2 GB dá mais folga)
- Qualquer opção de disco SSD que vier no plano básico já é suficiente

Depois de contratado, a Locaweb te dará:
- Um **endereço IP** do servidor
- Uma **senha de root** (ou chave SSH, dependendo do que você escolher)

## Passo 2 — Conectar no servidor

De um computador Windows, Mac ou Linux, abra o terminal (PowerShell no
Windows, Terminal no Mac/Linux) e digite, trocando pelo IP que a Locaweb
te deu:

```bash
ssh root@SEU_IP_AQUI
```

Confirme a conexão (digite `yes` se perguntado) e informe a senha que a
Locaweb enviou.

## Passo 3 — Rodar o script de instalação (uma vez só)

Depois de conectado, cole o comando abaixo. Ele baixa e prepara tudo que o
servidor precisa (Node.js, gerenciador de processo, Nginx, firewall):

```bash
curl -fsSL https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPOSITORIO/main/scripts/setup-locaweb.sh -o setup.sh && bash setup.sh
```

> Se vocês não usam GitHub, copie o conteúdo do arquivo
> `scripts/setup-locaweb.sh` (dentro deste pacote) e cole direto no terminal
> do servidor, ou envie o arquivo pelo `scp` antes de rodar `bash setup.sh`.

Isso instala: Node.js 20 LTS, o gerenciador de processos **PM2** (mantém o
sistema rodando sozinho e reinicia automaticamente se cair ou se o servidor
reiniciar), o **Nginx** (para expor a aplicação na porta 80/443 com um
domínio) e o **UFW** (firewall básico, liberando só SSH, HTTP e HTTPS).

## Passo 4 — Enviar os arquivos do sistema para o servidor

Do seu computador (não do servidor), na pasta onde está o arquivo
`ms-advocacia-server.zip`:

```bash
scp ms-advocacia-server.zip root@SEU_IP_AQUI:/var/www/
```

De volta no terminal do servidor (SSH):

```bash
cd /var/www
unzip ms-advocacia-server.zip
cd server-project
npm install --omit=dev
```

## Passo 5 — Configurar as variáveis de ambiente

```bash
cp .env.example .env
nano .env
```

Preencha pelo menos:
- `MONGODB_URI` — a mesma connection string do MongoDB Atlas que já usam
- `JWT_SECRET` — qualquer texto longo e aleatório
- `MASTER_SENHA_INICIAL` — a senha inicial do usuário master
- `PORT=3000` (ou deixe em branco, o padrão já é 3000)

Salve com `Ctrl+O`, `Enter`, e saia com `Ctrl+X`.

## Passo 6 — Iniciar o sistema com o PM2

```bash
pm2 start server.js --name ms-advocacia
pm2 save
pm2 startup
```

O último comando (`pm2 startup`) vai imprimir uma linha de comando — copie
exatamente o que ele mostrar na tela e cole de volta no terminal, para o
sistema iniciar sozinho sempre que o servidor for reiniciado.

## Passo 7 — Configurar o Nginx (para acessar pelo domínio, sem porta)

```bash
nano /etc/nginx/sites-available/ms-advocacia
```

Cole o conteúdo abaixo, trocando `seudominio.com.br` pelo domínio de vocês
(ou use o próprio IP do servidor, se ainda não tiver domínio configurado):

```nginx
server {
    listen 80;
    server_name seudominio.com.br;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Salve e ative:

```bash
ln -s /etc/nginx/sites-available/ms-advocacia /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

## Passo 8 — HTTPS gratuito (se já tiver domínio apontado para o IP)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d seudominio.com.br
```

Siga as perguntas na tela (informe um e-mail, aceite os termos). O Certbot
configura o HTTPS e renova o certificado sozinho a partir daí.

---

## Para atualizar o sistema no futuro (nova versão)

```bash
cd /var/www
scp ms-advocacia-server-NOVO.zip root@SEU_IP_AQUI:/var/www/   # do seu computador
unzip -o ms-advocacia-server-NOVO.zip                          # no servidor
cd server-project && npm install --omit=dev
pm2 restart ms-advocacia
```

## Comandos úteis do dia a dia

- Ver se está rodando: `pm2 status`
- Ver os logs em tempo real (para diagnosticar erro): `pm2 logs ms-advocacia`
- Reiniciar manualmente: `pm2 restart ms-advocacia`

---

## Sobre o DJEN nesta configuração

Com a aplicação inteira rodando num servidor físico no Brasil, **não é
necessário configurar `QUOTAGUARDSTATIC_URL` nem `DJEN_PROXY_URL`** — o
próprio servidor já sai para a internet com IP brasileiro. Se mesmo assim o
DJEN recusar a conexão depois de migrar, me avise com a mensagem de erro
exata, pois isso indicaria um motivo diferente do bloqueio geográfico.
