# Agent Memory POC (JavaScript)

Plain **JavaScript** port of `memory_ai_sdk` — same architecture, no TypeScript.

Working memory lives in **Redis**. Long-term memory splits **Postgres** (metadata + agent policy) and **OpenSearch** (content + vectors). Async LLM jobs run on **RabbitMQ**.

## Stack

```
Chat LLM + AI SDK tools (clients/js)
    → gRPC memory-api (src/grpc/server.js)
    → Redis working memory + Postgres/OpenSearch long-term memory
    → RabbitMQ → worker (summarize, session_end)
```

## Quick start

```bash
cd agent_memory_poc
cp .env.example .env   # then set OPENAI_API_KEY and OPENSEARCH_*
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
| **Session end** | `EndSession` button / tool | Postgres `memory_metadata` + OpenSearch content (semantic profile + episodic) |

**Semantic profile** is per `(agent_id, user_id)` — written only at **session end**, not during chat or summarize. The chat UI **Semantic profile** panel loads it via `Search` (empty query).

## gRPC surface (`proto/memory.proto`)

| RPC | Purpose |
|-----|---------|
| `Assemble` | Redis session + long-term hits → `context_block` for the LLM |
| `GetSession` | Redis snapshot (summary, recent, turn count) |
| `AppendTurn` | Persist one turn; may queue `memory.summarize` |
| `Search` | Semantic profile + hybrid episodic/experiential search |
| `EndSession` | Queue `memory.session_end` consolidation |
| `RegisterAgent` | Ensure store + generate `memory_code` |

Agents integrate via `clients/js/memory-client.js` — do not import `src/` internals.

## Chat UI sidebar

| Panel | Source |
|-------|--------|
| **Turns / summary** | Redis (`GetSession`) |
| **Semantic profile** | Postgres + OpenSearch (`Search`, scoped by user) |
| **Memories matched** | Last `recall_memory` assemble result |
| **Injected context** | `context_block` from assemble |

## Layout

| Path | Role |
|------|------|
| `src/index.js` | Platform bootstrap (`createMemoryPlatform`) |
| `src/grpc/server.js` | gRPC MemoryAPI |
| `src/controller/*` | Assemble, append, summarize, session_end |
| `src/stores/*` | Redis session + Postgres/OpenSearch memories |
| `src/worker/*` | RabbitMQ job handlers |
| `src/llm/*` | Memory LLM calls (summarize, session_end, memory_code generation) |
| `src/postgres/*` | Schema, metadata, agent stores |
| `src/opensearch/*` | Index management + hybrid search |
| `clients/js/*` | AI SDK tools + chat demo |
| `proto/memory.proto` | gRPC contract |
| `scripts/register-demo-agent.js` | One-shot demo agent registration |

## Data model: where things live

Long-term memory uses a **split store**: Postgres holds config and index metadata; OpenSearch holds searchable **content** (and embeddings). Redis holds **working memory** for the active conversation only.

```
Redis (session)          Postgres (config + metadata)     OpenSearch (content + vectors)
─────────────────        ────────────────────────────     ────────────────────────────
summary, recent turns    memory_stores (per agent)        {agentId}-memories index
turn_count               memory_types (global catalog)      content, embedding
last_prompt_tokens       memory_metadata (per memory)       BM25 + kNN search
                         memory_recall_log (audit)
```

### Redis — working memory (not Postgres/OpenSearch)

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

### `memory_types` — global catalog (Postgres only)

Three platform-wide rows seeded at agent registration (`semantic`, `episodic`, `experiential`). Describes *kinds* of long-term memory — not per-user data.

| Field | Description |
|-------|-------------|
| `type_key` | `semantic` \| `episodic` \| `experiential` |
| `scope_mode` | `user` (per-user) or `shared` (experiential → `__shared__`) |
| `write_trigger` | All are `session_end` in this POC |
| `profile_mode` | `true` for semantic (one profile blob per user) |

Runtime enabled types come from **`memory_stores.specification.types_enabled`**.

---

### `memory_stores` — one row per agent (Postgres only)

Agent-level policy and the generated **`memory_code`** (LLM extraction rules for summarize + session_end).

| Field | Description |
|-------|-------------|
| `agent_id` | Agent identifier (e.g. `demo_sales_agent`) |
| `memory_code` | Markdown policy — loaded for memory LLM jobs (`npm run register:demo`) |
| `specification` | JSON policy (`types_enabled`, `summarize_token_threshold`, etc.) |

---

### `memory_metadata` — index row per long-term memory (Postgres only)

**No content text here** — only a pointer to OpenSearch (`opensearch_doc_id`).

**Semantic** uses profile mode: one active row per `(agent, user, semantic)`.  
**Episodic / experiential** get a new row per session-end write (deduped by `source_message_id`).

Written at **session end** only.

---

### OpenSearch documents — content + embeddings

Index: `{OPENSEARCH_INDEX_PREFIX}{agentId}{-memories}`.

Hybrid **BM25 + kNN** for episodic/experiential. Semantic profile content is read by id; it is **always included** in assemble/search when it exists (keyword score used for ranking only).

---

### How they connect (session end)

```
EndSession → worker (memory.session_end)
  → LLM returns semantic_profile + episodic (+ optional experiential)
  → Postgres: upsert memory_metadata row(s)
  → OpenSearch: index document with content (+ embedding for episodic/experiential)
```

Assemble joins Postgres metadata + OpenSearch content + Redis session into `context_block`.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://memory:memory@127.0.0.1:5433/fluentmind_memory` | Postgres |
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `6379` | Redis session store |
| `RABBITMQ_URL` | `amqp://guest:guest@127.0.0.1:5672` | Async jobs |
| `GRPC_PORT` | `50052` | memory-api listen port |
| `OPENAI_API_KEY` | — | Required for LLM + embeddings |
| `OPENSEARCH_URL` | AWS domain in `.env` | Long-term content (not in docker-compose) |

Summarize threshold: `summarize_token_threshold` in `memory_stores.specification` or `clients/js` `DEFAULT_MEMORY_CONFIG` (default **1000**). Chat demo passes **total** input tokens across all LLM steps (`totalUsage`), not just the final step.

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
