# MemoryService — единый roadmap

Документ объединяет порядок разработки из правил проекта (`memory-service-project.mdc`, `memory-service-rules.mdc`) и дополнения из Agent, Extensions и Self-editing. **Master-последовательность** — блок ниже; расхождения со старым порядком в `memory-service-rules.mdc` (биллинг после типов памяти) отмечены в конце.

---

## Этапы (последовательность)

### Фаза 1 — Скелет и инфраструктура

- Docker Compose (nginx, backend, frontend, wordpress, postgres, mysql).
- Только nginx публикует 80/443 (в dev — как в спеках).
- Go: health endpoint, chi, pgx, базовые миграции (`users`, `api_keys`).
- Next.js 15: `basePath: '/dashboard'`, минимальный UI, светлая тема.
- WordPress-контейнер для маркетинга.
- Nginx-роутинг: `/` → WP, `/dashboard` → Next, `/api` и `/health` → backend.
- `.env.example`, Makefile, скрипты деплоя/бэкапов по deploy-правилам.

**Критерий:** `make dev`, `curl /health`, `/dashboard` и корень WP открываются.

---

### Фаза 2 — Аутентификация и роли

- Регистрация / логин, JWT с `role` (user / superadmin).
- API-ключи (хеширование, лимиты).
- Middleware: разделение пользовательских и админ-маршрутов.
- Суперадмин только через seed/CLI, не через публичную регистрацию.
- Базовые экраны dashboard: вход, сессия.

---

### Фаза 3 — Биллинг (фундамент)

- Таблицы: `plans`, `subscriptions`, `token_balances`, `payments`, при необходимости пакеты и промокоды.
- CRUD тарифов и пакетов (API + задел под суперадминку UI позже).
- Подписка / смена тарифа / отмена; списание токенов (plan → purchased FIFO).
- Проверка лимитов на защищаемых операциях; **402** при `TOKENS_EXHAUSTED`.
- MVP оплаты: ручная фиксация; без платёжного провайдера.

---

### Фаза 4 — RAG-память

- CRUD инстансов с учётом лимитов тарифа.
- Ingest / query / citations; usage logging на каждый LLM/embedding вызов.
- Playground в dashboard.
- **Из extensions:** async ingest по умолчанию (202 + `task_id`, `GET /tasks/...`), опционально `?sync=true`; **scoping** (`user_id` / `session_id`) на уровне данных RAG; страница задач / webhooks событий ingest (webhooks CRUD могут приехать в фазе 7 — см. ниже).
- **Отложено (бэклог):** настройки эмбеддингов на уровне инстанса — модель OpenRouter и размерность вектора в `memory_instances.config`, миграция БД под несколько размерностей (или одна выбранная модель на инстанс) вместо глобальных env и фиксированного `vector(1536)`.

---

### Фаза 4.5 — Agent (unified memory)

**Базовый слой (раньше улучшений Wiki):**

- Миграции: `agents`, `agent_layers`, связь с `memory_instances`.
- CRUD Agent и слоёв; правило: один тип памяти — один слой в агенте.
- `POST /agents/:id/query`: параллельный retrieval по слоям, затем synthesis с citations; логирование synthesis в `usage_log` с `agent_id`.
- `POST /agents/:id/ingest` с обязательным `target_layer` (MVP).
- Dashboard: список/создание агентов, слои, unified playground.

**Улучшения (можно чередовать с фазой 5–6):**

- Стратегии merge: `weighted`, `priority`, `all`; сборка контекста с `MaxContextTokens` и приоритетом обрезки (working не резать первым).
- Graceful degradation слоя; агрегированный `GET /agents/:id/health`.
- Поле `max_agents` в тарифах.

**Будущее (не в MVP roadmap):** auto-route ingest, cross-layer Gardener, шаблоны агентов.

---

### Фаза 5 — Wiki-память (Concept Hypothesis)

- Sources / segments / lineage; extraction (SGR, дешёвая модель) → router (create/attach/refine/reject) → compile; `action_log`, residuals.
- Query с citations; health-метрики (coverage, purity, stale_ratio и т.д.).
- **Gardener:** Phase 0 triage → proposals; approve/reject API; Phase 1 refactor только умной моделью; invalidation + repair queue.
- **Из extensions:** scoping на concepts / sources / segments.

---

### Фаза 6 — Остальные типы памяти

- **Episodic:** decay, bi-temporal timeline.
- **Working:** TTL, сессии.
- **Graph:** AGE, сущности/связи, repair queue.
- **Reflective:** реакции, паттерны, ограничения по evidence (например ≥3 эпизода для паттерна).

Порядок внутри фазы — по зависимостям и приоритету продукта.

---

### Фаза 7 — Суперадминка + операционка

- Дашборд платформы: MRR, пользователи, потребление, воркеры.
- Пользователи: блокировки, смена тарифа, impersonate, аудит `admin_audit_log`.
- Тарифы, пакеты, платежи, промокоды (если ещё не закрыты UI/API).
- Аналитика и мониторинг воркеров / OpenRouter.
- **Из extensions:** **Webhooks** — CRUD, подпись HMAC, доставка с retry, воркер dispatcher; при необходимости админ-страницы доставок.

---

### Фаза 8 — Уведомления, polish, документация, платежи

- Email и in-app уведомления (лимиты токенов, платежи, gardener и т.д.).
- MDX-документация API в dashboard.
- Интеграция платёжного провайдера (ЮKassa / CloudPayments / Тинькофф) после ручного MVP.

---

### Фаза 8.5 — SDK, MCP, Self-editing

- **SDK:** Python и TypeScript (httpx/fetch, ручная реализация, не codegen из OpenAPI); retry, 402/429.
- **MCP:** hosted endpoint, те же service-слои что REST; инструкции на `/dashboard/.../connect`.
- **Self-editing:** core/recall/archival tools; core memory в Working (`__persistent__` / `__core__`); лимиты размера и rate limits; audit `actor: self_edit`; опционально rollback; интеграция с Gardener для слабых archival inserts.
- Тарифные флаги: `self_editing_enabled`, `mcp_enabled` по планам.

---

### Фаза 9 — Production-hardening

- NATS JetStream, Dragonfly, MinIO (как в prod compose).
- SSL, мониторинг, бэкапы, rate limits по тарифам.
- Реплики и лимиты ресурсов; логирование Docker.

---

## Внутренние «фазы» Gardener (не путать с фазами roadmap)

- **Gardener Phase 0** — global triage, только proposals.
- **Gardener Phase 1** — хирургический refactor; мутации только здесь и после review где требуется.

---

## Сводка cross-cutting правил

| Тема | Когда |
|------|--------|
| Async ingest + tasks | Фаза 4 (RAG) |
| Scoping user/session | Фаза 4–5 (данные + индексы) |
| Agent unified API | Фаза 4.5 |
| Webhooks | Фаза 7 (после стабильных событий и биллинга) |
| SDK + MCP + Self-editing | Фаза 8.5 |
| Прод инфра | Фаза 9 |

---

## Примечание: старый порядок в `memory-service-rules.mdc`

В файле правил разработки указан укороченный путь: скелет → auth → **RAG → Wiki → Gardener → остальные типы → биллинг + production**. Текущий **единый** порядок для продукта и монетизации: **биллинг и лимиты до RAG (фазы 3–4)**, суперадминка и webhooks **после** основных типов памяти (фаза 7), production отдельной финальной фазой (9). При конфликте ориентируйтесь на этот документ и `memory-service-project.mdc`.

---

## Версия

- Сводка актуальна для набора правил в репозитории MAAS (memory-service-*.mdc). При изменении фаз в правилах обновляйте этот файл.
