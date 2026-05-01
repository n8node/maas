#!/usr/bin/env bash
# Issue Let's Encrypt certs and install into nginx/ssl/.
# Run on the server after DNS points here and HTTP stack is up (or nothing bound to :80).
# Default ACME email: erman.ai@yandex.ru (override CERTBOT_EMAIL in .env).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

CERTBOT_EMAIL="${CERTBOT_EMAIL:-erman.ai@yandex.ru}"
DOMAIN="${DOMAIN:-mnemoniqa.com}"

COMPOSE=(docker compose)
if [[ -f docker-compose.yml ]]; then
  COMPOSE+=( -f docker-compose.yml )
  [[ -f docker-compose.prod.yml ]] && COMPOSE+=( -f docker-compose.prod.yml )
else
  echo "docker-compose.yml not found — certbot will still run if port 80 is free." >&2
fi

echo ">>> ssl-init: DOMAIN=$DOMAIN CERTBOT_EMAIL=$CERTBOT_EMAIL"

need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }; }
need_cmd certbot

STOPPED=0
stop_nginx_if_needed() {
  [[ -f docker-compose.yml ]] || return 0
  if "${COMPOSE[@]}" ps nginx 2>/dev/null | grep -q 'Up'; then
    echo ">>> Stopping nginx container (free port 80 for certbot standalone)..."
    "${COMPOSE[@]}" stop nginx
    STOPPED=1
  fi
}

start_nginx_if_stopped() {
  [[ "$STOPPED" -eq 1 ]] || return 0
  echo ">>> Starting nginx..."
  "${COMPOSE[@]}" start nginx 2>/dev/null || "${COMPOSE[@]}" up -d nginx
}

stop_nginx_if_needed

sudo certbot certonly \
  --standalone \
  --non-interactive \
  --agree-tos \
  --email "$CERTBOT_EMAIL" \
  -d "$DOMAIN" \
  -d "www.$DOMAIN"

LE_DIR="/etc/letsencrypt/live/$DOMAIN"
[[ -f "$LE_DIR/fullchain.pem" ]] || { echo "Missing $LE_DIR/fullchain.pem" >&2; start_nginx_if_stopped; exit 1; }

mkdir -p "$ROOT/nginx/ssl"
echo ">>> Installing PEMs into nginx/ssl/"
sudo cp "$LE_DIR/fullchain.pem" "$ROOT/nginx/ssl/fullchain.pem"
sudo cp "$LE_DIR/privkey.pem" "$ROOT/nginx/ssl/privkey.pem"
sudo chmod 644 "$ROOT/nginx/ssl/fullchain.pem"
sudo chmod 640 "$ROOT/nginx/ssl/privkey.pem"

start_nginx_if_stopped

echo ">>> Certificate installed under nginx/ssl/"
echo ">>> Next: enable HTTPS in nginx — copy the sample and rebuild nginx:"
echo "       cp nginx/conf.d/https.conf.sample nginx/conf.d/https.conf"
echo "       ${COMPOSE[*]} build nginx && ${COMPOSE[*]} up -d nginx"
echo ">>> Optional: enable HTTP→HTTPS redirect (see comment in nginx/conf.d/default.conf)."
