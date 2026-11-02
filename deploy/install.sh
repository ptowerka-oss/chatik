#!/usr/bin/env bash
# Установка (и обновление) сервера «Чатик» на VPS с Ubuntu 22.04/24.04 или Debian 11/12.
# Запуск от root:  curl -fsSL https://raw.githubusercontent.com/ptowerka-oss/chatik/main/deploy/install.sh | bash
set -e
APP_DIR=/opt/chatik
DATA_DIR=/var/lib/chatik
PORT=${PORT:-80}

echo "==> Устанавливаю нужные программы"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates
need_node=1
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then need_node=0; fi
if [ $need_node = 1 ]; then
  apt-get install -y nodejs || true
  if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
fi
echo "Node.js: $(node -v)"

echo "==> Скачиваю приложение"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone --depth 1 https://github.com/ptowerka-oss/chatik "$APP_DIR"
fi
mkdir -p "$DATA_DIR"

echo "==> Настраиваю автозапуск"
cat > /etc/systemd/system/chatik.service <<UNIT
[Unit]
Description=Chatik messenger server
After=network.target

[Service]
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT
Environment=DATA_DIR=$DATA_DIR
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable chatik >/dev/null 2>&1
systemctl restart chatik

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then ufw allow "$PORT"/tcp; fi

sleep 2
IP=$(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
echo
echo "=============================================="
if curl -fsS --max-time 5 "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo " ГОТОВО. Адрес сервера для приложения:"
  [ "$PORT" = 80 ] && echo "   http://$IP" || echo "   http://$IP:$PORT"
else
  echo " Сервер не ответил. Посмотрите логи: journalctl -u chatik -n 30"
fi
echo "=============================================="
