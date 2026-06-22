# Postgres database architecture

FluentMind splits **policy + index metadata** (Postgres) from **searchable content** (OpenSearch).

---

## High-level split

```mermaid
flowchart LR
  subgraph PG["Postgres — config + metadata"]
    MT[memory_types<br/>global catalog × 3]
    MS[memory_stores<br/>1 per agent]
    MM[memory_metadata]
    MRL[memory_recall_log]
  end

  subgraph OS["OpenSearch — content + search"]
    IDX["{agentId}-memories index"]
  end

  MT -.->|"all agents use all 3"| MS
  MS --> MM
  MM -.->|"opensearch_doc_id"| IDX
```

---

## Entity-relationship diagram

```mermaid
erDiagram
  memory_stores {
    varchar id PK
    varchar agent_id UK
    varchar name
    varchar ref_name UK
    text memory_code
    jsonb specification
    timestamptz created_at
    timestamptz updated_at
  }

  memory_types {
    varchar id PK
    varchar type_key UK
    varchar display_name
    varchar scope_mode
    varchar write_trigger
    boolean embed_on_write
    boolean profile_mode
    int sort_order
    jsonb specification
    timestamptz created_at
  }

  memory_metadata {
    varchar id PK
    varchar agent_id
    varchar memory_type_key
    varchar scope
    varchar opensearch_doc_id
    real importance
    varchar source_message_id
    boolean is_deleted
    timestamptz created_at
    timestamptz updated_at
  }

  memory_recall_log {
    varchar id PK
    varchar agent_id
    varchar user_id
    varchar conversation_id
    text user_query
    jsonb memories_injected
    int latency_ms
    timestamptz created_at
  }
```

There is **no FK** between `memory_stores` and `memory_types`. Every agent implicitly uses the full global catalog. `memory_metadata.memory_type_key` matches `memory_types.type_key` by convention.

---

## Cardinality

```mermaid
flowchart TB
  A["agent_id"]
  MS["memory_stores — 1 row"]
  MST["memory_store_types — 3 id refs"]
  MT["memory_types — 3 global rows"]
  MM["memory_metadata — N rows"]

  A --> MS
  MS --> MST
  MT --> MST
  A --> MM
  MT -.->|"memory_type_key"| MM
```

| Relationship | Cardinality |
|--------------|-------------|
| Agent → store | **1 : 1** via `memory_stores.agent_id` |
| Catalog types | **3 rows total** (platform-wide) |
| Agent → metadata | **1 : N** |

On agent setup:

1. Ensure **3** global `memory_types` rows exist (once per platform)
2. Insert **1** `memory_stores` row with `agent_id`

---

## Quick mental model

```
GLOBAL (3 rows, shared by all agents)
  memory_types — semantic, episodic, experiential

PER AGENT
  memory_stores.agent_id — policy + memory_code

PER AGENT DATA
  memory_metadata.agent_id → OpenSearch doc
```

During testing, reset Postgres by dropping the Docker volume when the schema changes.

---

## Module map

| File | Tables |
|------|--------|
| `memory-types.ts` | `memory_types` |
| `memory-stores.ts` | `memory_stores` |
| `memory-metadata.ts` | `memory_metadata` |
| `recall-log.ts` | `memory_recall_log` |
