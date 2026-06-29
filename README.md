# Agent Memory POC (JavaScript)

Plain **JavaScript** port of `memory_ai_sdk` — same architecture, no TypeScript.

Working memory lives in **Redis**. Long-term memory splits **Postgres** (metadata + agent policy) and **Qdrant** (content + vectors, one collection per agent). Async LLM jobs run on **RabbitMQ**.

## Stack

```
Chat LLM + AI SDK tools (clients/js)
    → gRPC memory-api (src/grpc/server.js)
    → Redis working memory + Postgres/Qdrant long-term memory
    → RabbitMQ → worker (summarize, session_end)
```

## Quick start

```bash
cd agent_memory_poc
cp .env.example .env   # then set OPENAI_API_KEY
npm install
npm run docker:up
npm run register:demo    # once — creates memory_stores row + memory_code
npm run api                # terminal 1 — gRPC :50052
npm run worker             # terminal 2 — RabbitMQ consumer
npm run chat               # terminal 3 → http://127.0.0.1:3000
```

Standalone project — lives next to `memory_ai_sdk`:

```
Developer/Agent Memory/
├── memory_ai_sdk/      # TypeScript SDK
└── agent_memory_poc/   # this project (JavaScript)
```

## Memory lifecycle

| Phase | Trigger | What gets written |
|-------|---------|-------------------|
| **Turn** | `AppendTurn` after each chat reply | Redis `recent`, `turn_count`, `last_prompt_tokens` |
| **Summarize** | `lastPromptTokens >= summarize_token_threshold` (default **1000**) | Redis `summary` (worker compresses `recent` into rolling prose) |
| **Session end** | `EndSession` button / tool | Postgres `memory_metadata` + Qdrant content (semantic profile + episodic) |

**Semantic profile** is per `(agent_id, user_id)` — written only at **session end**, not during chat or summarize. The chat UI loads it via **`GetSemanticProfile`** at session start (not vector search).

## gRPC surface (`proto/memory.proto`)

| RPC | Purpose |
|-----|---------|
| `Assemble` | Redis session + semantic profile + vector recall → `context_block` |
| `GetSession` | Redis snapshot (summary, recent, turn count) |
| `AppendTurn` | Persist one turn; may queue `memory.summarize` |
| `GetSemanticProfile` | Load long-term semantic profile for agent + user |
| `Search` | Vector search over episodic/experiential only (semantic excluded) |
| `EndSession` | Queue `memory.session_end` consolidation |
| `RegisterAgent` | Ensure store + generate `memory_code` |

Agents integrate via `clients/js/memory-client.js` — do not import `src/` internals.

## Chat UI sidebar

| Panel | Source |
|-------|--------|
| **Turns / summary** | Redis (`GetSession`) |
| **Semantic profile** | `GetSemanticProfile` (Postgres metadata + Qdrant content) |
| **Memories matched** | Last `recall_memory` assemble result (episodic/experiential vector hits) |
| **Injected context** | `context_block` from assemble |

## Store layer (`src/stores/`)

Three store classes — one per backend. **`MemoryService`** coordinates Postgres + Qdrant for long-term memory; handlers never call stores directly except via `MemoryService` or `RedisStore`.

| Class | Backend | Responsibility |
|-------|---------|----------------|
| `RedisStore` | Redis | Working memory: summary, recent turns, token counters |
| `PostgresStore` | Postgres | All SQL: `memory_metadata`, `memory_stores`, `memory_recall_log`, `memory_types` seeding |
| `QdrantStore` | Qdrant | Collections, point upsert/retrieve, vector search |

**Trace path (session end → episodic write):**

```
SessionEndHandler → MemoryService.writeEpisodicSession
  → postgres.getMemoryBySourceMessageId / insertMemoryMetadata
  → embedText(...)
  → qdrant.upsertPoint(...)
```

Infrastructure only (pool / client factory): `src/postgres/client.js`, `src/qdrant/client.js`.

## Layout

| Path | Role |
|------|------|
| `src/index.js` | Platform bootstrap (`createMemoryPlatform`) |
| `src/grpc/server.js` | gRPC MemoryAPI |
| `src/controller/*` | Handlers + `MemoryService` (business logic, dual-write coordination) |
| `src/stores/RedisStore.js` | Redis session store |
| `src/stores/PostgresStore.js` | All Postgres access |
| `src/stores/QdrantStore.js` | All Qdrant access |
| `src/postgres/client.js` | Connection pool, schema bootstrap |
| `src/postgres/schema.sql` | Postgres DDL |
| `src/qdrant/client.js` | Qdrant client factory + probe |
| `src/worker/*` | RabbitMQ job handlers |
| `src/llm/*` | Memory LLM calls (summarize, session_end, memory_code generation) |
| `clients/js/*` | AI SDK tools + chat demo |
| `proto/memory.proto` | gRPC contract |
| `scripts/register-demo-agent.js` | One-shot demo agent registration |

## Prompts (`src/prompts/`)

Three **input** templates plus one **generated** mirror per agent:

| File | Layer | When used |
|------|-------|-----------|
| `platform.memory.system.md` | Platform | Every summarize + session_end job (system message) |
| `generate_agent_memory_code.md` | Platform | Registration only — instructs LLM how to write memory_code |
| `demo_sales_agent_prompt.md` | Agent | Registration only — source system prompt for demo agent |
| `memory_code/{agentId}.md` | Agent | **Written on register** — mirror of Postgres `memory_code` (for review in git) |

**`memory_code` ≠ `platform.memory.system.md`**

- **Platform prompt** — shared rules: JSON schemas, “semantic only on session_end”, etc.
- **memory_code** — per-agent policy: what facts to keep, how to summarize CRM/sales context, etc.

At runtime the memory LLM receives both:

```
system: platform.memory.system.md
user:   TASK: summarize | session_end
        AGENT_MEMORY_CODE: <from Postgres>
        INPUT: <session data>
```

Runtime loads `memory_code` from **Postgres** (`memory_stores.memory_code`). The `.md` file under `memory_code/` is updated whenever you run `npm run register:demo`.

## Data model: where things live

Long-term memory uses a **split store**: Postgres holds config and index metadata; Qdrant holds searchable **content** (and embeddings), one **collection per agent**. Redis holds **working memory** for the active conversation only.

```
Redis (session)          Postgres (config + metadata)     Qdrant (content + vectors)
─────────────────        ────────────────────────────     ────────────────────────────
summary, recent turns    memory_types (global catalog)    {prefix}{agentId} collection
turn_count               memory_stores (per agent)          content, embedding
last_prompt_tokens       memory_store_types (junction)      vector + payload filters
                         memory_metadata (per memory)
                         memory_recall_log (audit)
```

### Redis — working memory (not Postgres/Qdrant)

Per `conversation_id`, short-lived session state:

| Key | Content |
|-----|---------|
| `session:{id}:summary` | Rolling compressed summary (prose) |
| `session:{id}:recent` | JSON array of recent `{ id, user, assistant }` turns |
| `session:{id}:turn_count` | Total turns this session |
| `session:{id}:last_prompt_tokens` | Last chat LLM prompt token count (summarize trigger) |

Updated on every `AppendTurn`. Cleared on `EndSession` (optional). Summarize jobs compress evicted turns into `summary`.

**Local dev note:** If Homebrew Redis is running on `127.0.0.1:6379`, the app writes there (via `REDIS_HOST` in `.env`), not the empty Docker Redis container. Stop Homebrew Redis (`brew services stop redis`) or point Redis Insight at `host.docker.internal:6379`.

---

### Postgres — five tables in `fluentmind_memory`

Schema is applied on startup from `src/postgres/schema.sql`. Postgres holds **configuration + metadata only** — memory **content** lives in Qdrant.

| Table | Rows represent | Written when |
|-------|----------------|--------------|
| `memory_types` | Global catalog of memory kinds | Agent registration (seed) |
| `memory_stores` | One agent's policy + `memory_code` | `RegisterAgent` / `npm run register:demo` |
| `memory_store_types` | Which types an agent store enables | Agent registration (link) |
| `memory_metadata` | Index row per long-term memory | Session end |
| `memory_recall_log` | Assemble audit trail | Every `Assemble` with a user query |

---

#### `memory_types` — global catalog

Platform-wide rows describing *kinds* of long-term memory (`semantic`, `episodic`, `experiential`). Seeded at agent registration — not per-user data.

| Field | Type | Description |
|-------|------|-------------|
| `id` | VARCHAR(36) PK | UUID |
| `type_key` | VARCHAR(64) UNIQUE | `semantic` \| `episodic` \| `experiential` |
| `display_name` | VARCHAR(255) | Human label (e.g. "Semantic facts") |
| `scope_mode` | VARCHAR(32) | `user` (per-user scope) or `shared` (experiential → `__shared__`) |
| `write_trigger` | VARCHAR(32) | When this type is persisted — all `session_end` in this POC |
| `embed_on_write` | BOOLEAN | Whether to embed content in Qdrant (`true` for episodic/experiential) |
| `profile_mode` | BOOLEAN | `true` for semantic — one profile blob per user, upserted not appended |
| `sort_order` | INT | Display / link ordering |
| `specification` | JSONB | Optional per-type config (defaults to `{}`) |
| `created_at` | TIMESTAMPTZ | Row creation time |

Runtime enabled types come from **`memory_stores.specification.types_enabled`**, not by querying this table directly on every request.

---

#### `memory_stores` — one row per agent

Agent-level policy and the generated **`memory_code`** (LLM extraction rules for summarize + session_end).

| Field | Type | Description |
|-------|------|-------------|
| `id` | VARCHAR(36) PK | UUID — internal store id |
| `agent_id` | VARCHAR(255) UNIQUE | Agent identifier (e.g. `demo_sales_agent`) |
| `name` | VARCHAR(255) | Display name (e.g. "Default memory — demo_sales_agent") |
| `ref_name` | VARCHAR(255) UNIQUE | Internal reference (e.g. `default_demo_sales_agent`) |
| `description` | TEXT | Optional agent description |
| `memory_code` | TEXT | Markdown policy — loaded for memory LLM jobs (`npm run register:demo`) |
| `specification` | JSONB | Policy JSON — see below |
| `created_at` | TIMESTAMPTZ | Row creation time |
| `updated_at` | TIMESTAMPTZ | Last update (e.g. when `memory_code` is regenerated) |

**`specification` JSON keys:**

| Key | Default | Purpose |
|-----|---------|---------|
| `types_enabled` | `["semantic","episodic","experiential"]` | Which memory types this agent writes/recalls |
| `retrieval_k` | `4` | Vector recall top-K |
| `summarize_token_threshold` | `1000` | Prompt token count that triggers `memory.summarize` |
| `embed_model` | `text-embedding-3-large` | Embedding model hint |

---

#### `memory_store_types` — agent ↔ type junction

Links each `memory_stores` row to the global `memory_types` catalog. One row per (store, type) pair.

| Field | Type | Description |
|-------|------|-------------|
| `memory_store_id` | VARCHAR(36) FK → `memory_stores.id` | Agent store |
| `memory_type_id` | VARCHAR(36) FK → `memory_types.id` | Catalog type |

**Primary key:** `(memory_store_id, memory_type_id)`. All three types are linked when an agent is registered.

---

#### `memory_metadata` — index row per long-term memory

**No content text here** — `id` is the Qdrant point id (content + vectors live in Qdrant).

| Field | Type | Description |
|-------|------|-------------|
| `id` | VARCHAR(36) PK | UUID — same value as the Qdrant point id |
| `agent_id` | VARCHAR(255) | Agent that owns this memory |
| `memory_type_key` | VARCHAR(64) | `semantic` \| `episodic` \| `experiential` |
| `scope` | VARCHAR(255) | User id for semantic/episodic; `__shared__` for experiential |
| `source_message_id` | VARCHAR(255) | Idempotency key — e.g. `session_end:{conversationId}` or `experiential:{conversationId}` |
| `is_deleted` | BOOLEAN | Soft-delete flag (default `false`) |
| `created_at` | TIMESTAMPTZ | Row creation time |
| `updated_at` | TIMESTAMPTZ | Last update (retries on same idempotency key update this row) |

**Write behavior:**

- **Semantic** — profile mode: one active row per `(agent_id, scope, semantic)`; upserted at session end.
- **Episodic / experiential** — one row per session-end write; deduped by `(source_message_id, memory_type_key)`.

**Indexes:** unique partial index on `(source_message_id, memory_type_key)`; index on `(agent_id, scope)`.

Written at **session end** only (not during chat or summarize).

---

#### `memory_recall_log` — assemble audit trail

Records what long-term memories were injected during each `Assemble` call (when the user query is non-empty).

| Field | Type | Description |
|-------|------|-------------|
| `id` | VARCHAR(36) PK | UUID |
| `agent_id` | VARCHAR(255) | Agent |
| `user_id` | VARCHAR(255) | User |
| `conversation_id` | VARCHAR(255) | Conversation |
| `user_query` | TEXT | Query passed to `Assemble` / vector search |
| `memories_injected` | JSONB | Array of recalled memory objects (id, type, content, score) |
| `latency_ms` | INT | Assemble duration in milliseconds |
| `created_at` | TIMESTAMPTZ | When the assemble happened |

**Index:** `(agent_id, created_at DESC)` for per-agent audit queries.

---

### Qdrant points — content + embeddings

Collection: `{QDRANT_COLLECTION_PREFIX}{agentId}` (created on first write).

Vector similarity search for **episodic/experiential** only. Semantic profile content is read by point id via `GetSemanticProfile` (zero vector in Qdrant; not included in vector search).

---

### How they connect (session end)

```
EndSession → worker (memory.session_end)
  → LLM returns semantic_profile + episodic (+ optional experiential)
  → MemoryService coordinates:
      postgres: upsert memory_metadata row(s)
      qdrant:   upsert point with content (+ embedding for episodic/experiential)
```

Assemble loads semantic profile separately, then Redis session + vector recall into `context_block`.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://memory:memory@127.0.0.1:5433/fluentmind_memory` | Postgres |
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `6379` | Redis session store |
| `RABBITMQ_URL` | `amqp://guest:guest@127.0.0.1:5672` | Async jobs |
| `GRPC_PORT` | `50052` | memory-api listen port |
| `OPENAI_API_KEY` | — | Required for LLM + embeddings |
| `QDRANT_URL` | `http://127.0.0.1:6333` | Long-term content (docker-compose) |
| `MEMORY_RETRIEVAL_K` | `4` | Vector recall top-K in assemble/search |
| `MEMORY_SUMMARIZE_TOKEN_THRESHOLD` | `1000` | Queue summarize when prompt tokens exceed this |
| `MEMORY_MAX_CONTENT_CHARS` | `6000` | Max chars per semantic/episodic/experiential field at write time |

Summarize threshold: chat demo passes **total** input tokens across all LLM steps (`totalUsage`), not just the final step.

## Dev UIs

### pgAdmin — http://localhost:5050

Login: `admin@local.dev` / `admin`

Register server → Connection:

| Field | Value |
|-------|--------|
| Host | `postgres` (inside Docker) or `127.0.0.1:5433` from Mac |
| Database | `fluentmind_memory` |
| User / Password | `memory` / `memory` |

Browse: **Schemas → public → Tables** → right-click → **View/Edit Data → All Rows**.

### Redis Insight — http://localhost:5540

| Scenario | Host | Port |
|----------|------|------|
| App uses Homebrew Redis (`REDIS_HOST=127.0.0.1`) | `host.docker.internal` | `6379` |
| App uses Docker Redis only (Homebrew stopped) | `redis` | `6379` |

Filter keys: `session:*`

### RabbitMQ — http://localhost:15672

Default: `guest` / `guest`

## vs TypeScript SDK

- All `src/**/*.js` — transpiled from TS with esbuild, type imports stripped
- No `tsx`, `tsc`, or `types.ts`
- Per-turn observe / Upsert / skills removed — semantic writes are **session_end only**

## Request flow (chat demo)

```
Browser (chat-ui/app.js)
    │  HTTP POST /api/chat
    ▼
chat-demo.js
    ├─► GetSemanticProfile → inject into system prompt
    ├─► OpenAI generateText({ tools })
    │       └─► recall_memory → gRPC Assemble → Redis + MemoryService → Postgres/Qdrant
    └─► appendTurn → gRPC → Redis (+ maybe RabbitMQ summarize)

End session:
    POST /api/session/end → gRPC EndSession → RabbitMQ → worker
        → SessionEndHandler → MemoryService → PostgresStore + QdrantStore
```