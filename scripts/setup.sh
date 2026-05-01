#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/backups"
mkdir -p "$ROOT/nginx/ssl"
chmod +x "$ROOT/scripts/deploy.sh" "$ROOT/scripts/backup.sh" "$ROOT/scripts/ssl-init.sh" "$ROOT/scripts/ssl-deploy-hook.sh" 2>/dev/null || true
echo "Mnemoniqa: directories OK, scripts executable."
