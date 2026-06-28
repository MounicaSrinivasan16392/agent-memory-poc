# Memory integration flow (chat demo)

End-to-end path from the browser UI through AI SDK tools, gRPC client, memory-api server, and async worker jobs.

## Stack overview

```
Browser (chat-ui/app.js)
    │  HTTP
    ▼
chat-demo.js (npm run chat)
    │
    ├─► OpenAI generateText({ tools })
    │       │
    │       │  LLM calls a tool (e.g. recall_memory)
    │       ▼
    │   memory-tools.js
    │       │
    │       ▼
    │   memory-client.js (MemoryClient)
    │       │
    │       ▼  gRPC TCP :50052
    │   src/grpc/server.js
    │       │
    │       ▼
    │   src/controller/* (Assemble, AppendTurn, …)
    │       │
    │       ├─► Redis (working memory)
    │       ├─► Postgres + Qdrant (long-term memory)
    │       └─► RabbitMQ (async: summarize, session_end)
    │               │
    │               ▼
    │           worker (npm run worker)
    │
    └─► memory-client.js direct calls (see below)
```

**Short answer:** When the LLM uses a tool, the path is:

`chat-demo` → `memory-tools.js` → `memory-client.js` → gRPC server → platform code.

`chat-demo` also calls `MemoryClient` **directly** for some operations (not always via tools).

---

## Prerequisites

| Process | Command | Port |
|---------|---------|------|
| Postgres, Redis, RabbitMQ | `npm run docker:up` | 5433, 6379, 5672 |
| memory-api (gRPC) | `npm run api` | 50052 |
| Worker | `npm run worker` | — |
| Chat demo + UI | `npm run chat` | 3000 |

Agent registration (once): `npm run register:demo`

---

## One user message (step by step)

### 1. Browser → chat-demo

1. User submits a message in the chat UI.
2. `chat-ui/app.js` sends `POST /api/chat` with `{ message, agentId, userId, conversationId }`.
3. `chat-demo.js` → `handleChat()` receives the request.

### 2. Setup tools and LLM

1. At startup, `createMemoryClient()` connects to `MEMORY_GRPC_HOST:MEMORY_GRPC_PORT` (default `127.0.0.1:50052`).
2. `createMemoryTools(memory, toolCtx)` builds AI SDK tools that wrap `MemoryClient` methods.
3. `generateText({ tools, prompt: message, system: SYSTEM_PROMPT, … })` runs the chat LLM.

### 3. LLM calls a tool → gRPC

When the model invokes a tool, execution goes through:

```
tool.execute() in memory-tools.js
  → memoryClient.<method>(...)
  → unary(_client, '<RpcName>', request)
  → src/grpc/server.js handler
  → controller / stores (Redis, Postgres, Qdrant)
  → response returned to LLM as tool result
```

| Tool | MemoryClient method | gRPC RPC |
|------|---------------------|----------|
| `recall_memory` | `assemble()` | `Assemble` |
| `search_memories` | `search()` | `Search` |
| `append_turn` | `appendTurn()` | `AppendTurn` |
| `end_session` | `endSession()` | `EndSession` |

Proto contract: `proto/memory.proto` (shared by client and server).

### 4. After LLM finishes — persist turn (current demo)

**Current behavior:** `handleChat()` calls `memory.appendTurn()` **directly** after `generateText`, using `inputTokensFromGenerateText(result)` for the summarize token threshold.

The `append_turn` tool is registered but the demo does not rely on the LLM calling it for persistence (avoids duplicate turns; ensures accurate token counts).

### 5. Build HTTP response

`handleChat()` returns JSON to the UI:

- `reply` — assistant text
- `assemble` — last `recall_memory` tool output (context block, memories)
- `session` — Redis snapshot via `getSession()`
- `semanticProfile` — long-term profile via `search()` / `assemble()`
- `jobs` — `summarizeScheduled`, `lastPromptTokens`

---

## Direct MemoryClient calls (not via LLM tools)

| Caller | Method | gRPC RPC | When |
|--------|--------|----------|------|
| `handleChat` | `appendTurn()` | `AppendTurn` | After every chat reply |
| `handleChat` / `/api/state` | `getSession()` | `GetSession` | Session panel |
| `loadSemanticProfile` | `search()`, `assemble()` | `Search`, `Assemble` | Semantic profile panel |
| `/api/session/end` | `endSession()` | `EndSession` | UI “End session” button |

---

## gRPC server → async worker

The client waits only for the gRPC response. Some RPCs enqueue RabbitMQ jobs on the server:

| RPC | RabbitMQ routing key | Worker handler | Effect |
|-----|----------------------|----------------|--------|
| `AppendTurn` (tokens ≥ threshold) | `memory.summarize` | `worker/jobs/summarize.js` | Redis rolling `summary` |
| `EndSession` | `memory.session_end` | `worker/jobs/session_end.js` | Semantic profile + episodic → Postgres/Qdrant |

Summarize and session_end LLM calls use:

- **System:** `src/prompts/platform.memory.system.md`
- **User:** `TASK` + `AGENT_MEMORY_CODE` (from Postgres) + `INPUT` (session data)

---

## UI routes (HTTP, not gRPC)

| Route | Purpose |
|-------|---------|
| `GET /api/health` | Connectivity check |
| `GET /api/state` | Session + semantic profile for sidebar |
| `POST /api/chat` | User message → LLM + memory |
| `POST /api/session/end` | Queue session_end consolidation |
| Static `/` | `chat-ui/` (index.html, app.js, style.css) |

---

## File map (`clients/js/`)

| File | Role |
|------|------|
| `chat-demo.js` | HTTP server, LLM orchestration, direct client calls |
| `memory-tools.js` | AI SDK tool definitions → MemoryClient |
| `memory-client.js` | gRPC stub wrapper (`@grpc/grpc-js` + `memory.proto`) |
| `usage-tokens.js` | Token counting for summarize threshold |
| `index.js` | Public exports (`package.json` → `"./client"`) |
| `chat-ui/app.js` | Browser client for `/api/*` |

---

## Memory lifecycle (reference)

| Phase | Trigger | Storage |
|-------|---------|---------|
| Turn | `AppendTurn` | Redis `recent`, `turn_count`, `last_prompt_tokens` |
| Summarize | tokens ≥ `summarize_token_threshold` | Redis `summary` (worker) |
| Session end | `EndSession` | Postgres `memory_metadata` + Qdrant content |

Semantic profile is per `(agent_id, user_id)` — written at **session end**, not during chat.
