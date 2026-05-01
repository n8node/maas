#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
KIND="${1:-db}"
DATE="$(date +%Y%m%d_%H%M%S)"
mkdir -p backups

case "$KIND" in
  db)
    docker compose exec -T postgres pg_dump -U mnemoniqa mnemoniqa | gzip > "backups/pg_${DATE}.sql.gz"
    echo "Saved backups/pg_${DATE}.sql.gz"
    ;;
  wp)
    source .env 2>/dev/null || true
    docker compose exec -T mysql mysqldump -u wordpress -p"${WP_DB_PASSWORD:-wordpress}" wordpress | gzip > "backups/wp_${DATE}.sql.gz"
    echo "Saved backups/wp_${DATE}.sql.gz"
    ;;
  *)
    echo "Usage: $0 [db|wp]"
    exit 1
    ;;
esac
