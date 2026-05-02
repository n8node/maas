# Wiki memory — implementation report (MAAS)

## Scope

This iteration delivers a **production-oriented Wiki vertical slice** aligned with internal rules (Concept Hypotheses direction, lineage, action log, gardener, health) and the **Mnemoniqa design system** (Wiki accent `#534ab7` / `#eeedfe`, playground layout, stats row, tabs).

## Backend

### Schema (`migrations/00007_wiki_full.sql`)

- **`wiki_sources.user_scope`** — optional end-user scoping; query filters when `user_id` is passed.
- **`wiki_concepts.concept_type`** — default `fact`; states extended to include `stale`, `disputed` (in addition to `active`, `weak`, `archived`).
- **`wiki_action_log`** — append-only log: `actor`, `action`, `target_kind`, `target_id`, `payload` (JSONB), `rationale`, `created_at`.
- **`wiki_gardener_proposals`** — `merge_concepts` proposals with `pending|approved|rejected|dismissed` workflow.

### Ingest & extraction

- **Ingest** still splits text with shared `splitChunks`; persists **sources + segments**; optional **manual** `concepts` in JSON.
- **Auto-extract** (config `auto_extract: true` or `extraction.auto: true`): after successful ingest, **`runWikiExtraction`** calls **OpenRouter chat** (`OPENROUTER_CHAT_MODEL`, default `google/gemini-2.0-flash-001`) to emit a JSON array of candidate concepts; **router-lite** applies create vs attach-on-duplicate-title; **billing** charges LLM `usage` tokens.
- **Action log** records `ingest.complete`, `extract.*`, `router.concept.create`, `router.concept.attach_evidence`, etc.

### Query

- **Full-text** on `wiki_segments` with **user scope** filter on `wiki_sources.user_scope` when the client passes `user_id`.

### Gardener (Phase 0)

- **`POST /instances/:id/wiki/gardener/triage`**: finds duplicate **active** concept titles; inserts **`merge_concepts`** proposals.
- **Approve / reject** endpoints apply merge (archive non-keepers) or dismiss.

### New REST routes (all under `/api/v1`, authenticated)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/instances/:id/wiki/health` | Coverage, purity, stale_ratio, counts |
| GET | `/instances/:id/wiki/sources` | Sources + segment counts |
| GET | `/instances/:id/wiki/concepts` | List (`?search=`) |
| PATCH | `/instances/:id/wiki/concepts/:conceptId` | Update state / description |
| GET | `/instances/:id/wiki/action-log` | Last actions |
| GET | `/instances/:id/wiki/gardener/proposals` | `?status=` |
| POST | `/instances/:id/wiki/gardener/triage` | Run duplicate-title triage |
| POST | `/instances/:id/wiki/gardener/proposals/:proposalId/approve` | Apply merge |
| POST | `/instances/:id/wiki/gardener/proposals/:proposalId/reject` | Reject |

### Wiring

- **`OPENROUTER_CHAT_MODEL`** in config + **`internal/openrouter/chat.go`**.
- **`memory.WithChat`** when `OPENROUTER_API_KEY` is set (alongside embeddings).

## Frontend

- **`WikiInstancePanels`** — stats strip, tabs **Playground | Concepts | Sources | Action log | Gardener**, ingest/query aligned with design (purple **Run query**, black **Ingest**, optional `user_id` / `top_k`).
- **`InstanceDetail`** delegates Wiki instances to this panel; RAG keeps the previous Files + playground flow.
- **`api.ts`** — wiki helpers + **`patchInstance`** for toggling **`auto_extract`** on the instance config.
- **Wizard (`InstancesNew`)** — for Wiki, sets **`auto_extract: gardenerEnabled`** so auto-extraction follows the Gardener toggle from the wizard.

## Not done / backlog (vs full roadmap doc)

- Async ingest / task queue, URL ingestion UI.
- Full **SGR** multi-pass extraction, mention spans, compile-to-page graph.
- Gardener Phase 1 surgical refactor, invalidation/repair queues as first-class workers.
- **`usage_log`** table for every LLM call (action log covers semantic ops today).
- Session scoping beyond storing flags in `config`.

## Operations

- Apply migration **`00007_wiki_full.sql`** (goose / your migration runner).
- Set **`OPENROUTER_API_KEY`**; optionally **`OPENROUTER_CHAT_MODEL`**.
- Enable extraction per instance: **`auto_extract: true`** (wizard preset or PATCH instance `config`).
