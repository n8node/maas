COMPOSE ?= docker compose
COMPOSE_PROD := $(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml
COMPOSE_DEV := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: dev prod down migrate migrate-down test lint logs logs-prod psql wp-cli deploy backup-db backup-wp status ssl-init setup seed-superadmin

## Development stack (frontend hot-reload)
dev:
	$(COMPOSE_DEV) up --build

## Production-like stack (same compose files as server without prod limits)
prod:
	$(COMPOSE_PROD) up -d --build

down:
	$(COMPOSE) down --remove-orphans

migrate:
	@echo "Migrations are applied automatically on backend startup (goose + embedded SQL)."

migrate-down:
	@echo "migrate-down is not wired in Phase 1."

test:
	@echo "Run: $(COMPOSE) run --rm backend go test ./...  (after compose build)"

lint:
	@echo "Run go vet / golangci-lint and npm run lint when toolchains are installed."

logs:
	$(COMPOSE) logs -f

logs-prod:
	$(COMPOSE_PROD) logs -f

psql:
	$(COMPOSE) exec postgres psql -U mnemoniqa -d mnemoniqa

wp-cli:
	$(COMPOSE) exec wordpress wp --allow-root

deploy:
	./scripts/deploy.sh main

backup-db:
	./scripts/backup.sh db

backup-wp:
	./scripts/backup.sh wp

status:
	$(COMPOSE) ps

ssl-init:
	chmod +x scripts/ssl-init.sh && ./scripts/ssl-init.sh

setup:
	chmod +x scripts/setup.sh scripts/deploy.sh scripts/backup.sh scripts/ssl-init.sh scripts/ssl-deploy-hook.sh
	./scripts/setup.sh

## Superadmin seed (CLI only). Usage: make seed-superadmin EMAIL=a@b.co PASSWORD='secure-long-pass'
seed-superadmin:
	@test -n "$(EMAIL)" || (echo "Set EMAIL= and PASSWORD= (min 12 chars)"; exit 1)
	@test -n "$(PASSWORD)" || (echo "Set PASSWORD="; exit 1)
	$(COMPOSE_PROD) run --rm --entrypoint /app/seed backend -email="$(EMAIL)" -password="$(PASSWORD)"
