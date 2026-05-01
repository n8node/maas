#!/usr/bin/env bash
# Certbot deploy-hook: after successful renew, sync PEMs into project and reload nginx.
# Register with: certbot renew --deploy-hook "$(pwd)/scripts/ssl-deploy-hook.sh"
# Or in cron: certbot renew --quiet --deploy-hook "/opt/maas/scripts/ssl-deploy-hook.sh"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DOMAIN="${DOMAIN:-mnemoniqa.com}"
LE_DIR="/etc/letsencrypt/live/$DOMAIN"

[[ -f "$LE_DIR/fullchain.pem" ]] || exit 0

mkdir -p "$ROOT/nginx/ssl"
cp "$LE_DIR/fullchain.pem" "$ROOT/nginx/ssl/fullchain.pem"
cp "$LE_DIR/privkey.pem" "$ROOT/nginx/ssl/privkey.pem"
chmod 644 "$ROOT/nginx/ssl/fullchain.pem"
chmod 640 "$ROOT/nginx/ssl/privkey.pem"

if [[ -f docker-compose.yml ]]; then
  COMPOSE=(docker compose -f docker-compose.yml)
  [[ -f docker-compose.prod.yml ]] && COMPOSE+=( -f docker-compose.prod.yml )
  if "${COMPOSE[@]}" ps nginx 2>/dev/null | grep -q 'Up'; then
    "${COMPOSE[@]}" exec -T nginx nginx -s reload
  fi
fi
