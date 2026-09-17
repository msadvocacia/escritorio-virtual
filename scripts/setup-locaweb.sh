#!/bin/bash
# Instalação inicial do servidor (Locaweb Cloud Server / Ubuntu) para rodar o
# sistema MS Advocacia. Rode isso UMA VEZ, logo depois de conectar via SSH
# num servidor novo. Veja o passo a passo completo em DEPLOY_LOCAWEB.md.
set -e

echo "== Atualizando pacotes do sistema =="
apt update && apt upgrade -y

echo "== Instalando Node.js 20 LTS =="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

echo "== Instalando Nginx (proxy web) =="
apt install -y nginx

echo "== Instalando unzip (para extrair o pacote do sistema) =="
apt install -y unzip

echo "== Instalando o PM2 (mantém o sistema rodando e reinicia sozinho) =="
npm install -g pm2

echo "== Configurando o firewall (libera só SSH, HTTP e HTTPS) =="
apt install -y ufw
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

mkdir -p /var/www

echo ""
echo "=================================================================="
echo "Instalação base concluída."
echo "Node.js: $(node -v)"
echo "Próximo passo: envie o arquivo ms-advocacia-server.zip para"
echo "/var/www no servidor (via scp, a partir do seu computador) e siga"
echo "o Passo 4 em diante do arquivo DEPLOY_LOCAWEB.md."
echo "=================================================================="
