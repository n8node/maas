# Промпт для Cursor — Фаза 1

Вставь в Cursor:

---

Прочитай все правила в `.cursor/rules/` — там 6 файлов, описывающих проект Memory-as-a-Service:
- memory-service-rules.mdc — архитектура и стек
- memory-service-project.mdc — продукт, роли, биллинг
- memory-service-agent.mdc — Agent (unified memory)
- memory-service-extensions.mdc — SDK, Webhooks, MCP, Scoping, Async
- memory-service-self-editing.mdc — Self-editing memory
- memory-service-deploy.mdc — деплой, Git, серверная инфраструктура

Выполни **Фазу 1: Скелет и инфраструктура.** Создай ВСЁ за один проход:

**1. Backend (Go):**
- Go-модуль `github.com/{username}/memory-service` (замени {username} на мой GitHub username)
- Зависимости: chi, pgx/v5, goose, caarlos0/env, go-playground/validator
- `cmd/server/main.go` — точка входа, запуск HTTP-сервера, подключение к Postgres, запуск миграций
- `internal/config/config.go` — чтение конфигурации из env
- `internal/server/server.go` — chi-роутер, middleware, маунт handler'ов
- `internal/middleware/logging.go` — slog middleware
- `internal/middleware/cors.go` — CORS
- `internal/handler/health.go` — `GET /health` → `{"status":"ok","version":"0.1.0"}`
- `internal/repository/postgres.go` — подключение через pgx pool
- `Dockerfile` (production, multi-stage, alpine)
- `Dockerfile.dev` (с air для hot reload)
- `.air.toml`
- `migrations/001_init.up.sql` и `001_init.down.sql` — таблицы users и api_keys согласно правилам

**2. Frontend (Next.js):**
- Next.js 15, App Router, TypeScript, Tailwind CSS
- `next.config.ts`: `basePath: '/dashboard'`, `output: 'standalone'`
- shadcn/ui, lucide-react
- `src/app/layout.tsx` — минималистичный layout, светлая тема, Inter
- `src/app/page.tsx` — «MemoryService Dashboard — Coming soon»
- `Dockerfile` и `Dockerfile.dev`

**3. WordPress:**
- `wordpress/Dockerfile` (wordpress:6-php8.3-apache + wp-cli)

**4. Nginx:**
- `nginx/Dockerfile` (nginx:1.27-alpine)
- `nginx/nginx.conf` — базовый (worker_processes auto, gzip on)
- `nginx/conf.d/default.conf` — полный роутинг:
  - `/api/` → backend:8080 (timeout 120s, body 50M)
  - `/health` → backend
  - `/dashboard` → frontend:3000 (websocket upgrade)
  - `/_next/` → frontend (cache 365d)
  - `/wp-admin/`, `/wp-content/`, `/wp-includes/`, `/wp-json/`, `/wp-login.php` → wordpress
  - `/` → wordpress
  - SSL server block — закомментированный, готовый к включению
- `nginx/ssl/` — пустая директория с `.gitkeep`

**5. Docker Compose:**
- `docker-compose.yml` — nginx, backend, frontend, wordpress, postgres (pgvector:pg16), mysql
- `docker-compose.prod.yml` — replicas, resource limits, logging, nats, dragonfly, minio (закомментированы до нужды)
- Порты наружу ТОЛЬКО у nginx (80, 443)
- Healthcheck для postgres и mysql
- Volumes: postgres_data, mysql_data, wp_uploads

**6. Инфраструктурные файлы:**
- `.env.example` — ВСЕ переменные из правил (Postgres, MySQL/WP, OpenRouter, Backend, Frontend, Workers)
- `.gitignore` — полный, из deploy правил (Go, Node, Docker, .env, ssl, uploads, backups, IDE, OS)
- `Makefile` — все команды из правил: dev, prod, down, migrate, migrate-down, test, lint, logs, logs-prod, psql, wp-cli, deploy, backup-db, backup-wp, status
- `scripts/deploy.sh` — скрипт деплоя на сервер (из deploy правил), с плейсхолдером для SERVER IP
- `scripts/backup.sh` — скрипт бэкапов (из deploy правил)
- `scripts/setup.sh` — первичная настройка (создание директорий, chmod на скрипты)
- `backups/.gitkeep`

**7. Git инициализация:**
- Инициализируй git репозиторий
- Первый коммит: `feat: initial project structure (Phase 1)`
- Покажи команды для подключения remote и push на GitHub

**Критерий успеха:**
1. `cp .env.example .env` + заполнить пароли
2. `make dev` — все 6 контейнеров стартуют без ошибок
3. `curl http://localhost/health` → `{"status":"ok","version":"0.1.0"}`
4. `http://localhost/dashboard` → Next.js страница
5. `http://localhost/` → WordPress setup wizard
6. `git log` показывает первый коммит

Не пропускай ни один файл. Создай ВСЁ. После завершения покажи:
- Список всех созданных файлов
- Команды для запуска
- Команды для git push на GitHub
- Команды для первого деплоя на сервер
