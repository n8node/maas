#!/usr/bin/env bash
set -euo pipefail
SERVER="${DEPLOY_SERVER:-deploy@YOUR_SERVER_IP}"
PROJECT_DIR="${DEPLOY_DIR:-/opt/maas}"
BRANCH="${1:-main}"

echo "=== Deploy branch: $BRANCH → $SERVER:$PROJECT_DIR ==="

ssh "$SERVER" bash -s <<EOF
set -euo pipefail
cd "$PROJECT_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres pg_isready -U mnemoniqa || true
sleep 3
curl -sf http://127.0.0.1/health || echo "WARN: health check failed"
echo "=== Deploy finished ==="
EOF
