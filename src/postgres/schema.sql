-- FluentMind memory — Postgres schema
--
-- ROLE: Postgres holds **configuration + metadata only**. Memory **content** lives in
-- Qdrant (one collection per agent). memory_metadata.id = Qdrant point id.
--
-- MODEL:
--   memory_types        — global catalog (semantic, episodic, experiential)
--   memory_stores       — one row per agent (agent_id), policy + memory_code
--   memory_store_types  — junction: memory_store_id → memory_type_id
--   memory_metadata     — durable index metadata for long-term memories
--   memory_recall_log   — assemble audit trail
--
-- Applied on startup by: src/postgres/client.js → initPostgres()
-- Reset DB during testing: drop volume and re-run docker compose up
-- ─────────────────────────────────────────────────────────────────────────────

-- ── memory_types (global catalog) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_types (
  id                VARCHAR(36) PRIMARY KEY,
  type_key          VARCHAR(64) UNIQUE NOT NULL,
  display_name      VARCHAR(255) NOT NULL,
  scope_mode        VARCHAR(32) NOT NULL DEFAULT 'user',
  write_trigger     VARCHAR(32) NOT NULL DEFAULT 'session_end',
  embed_on_write    BOOLEAN NOT NULL DEFAULT FALSE,
  profile_mode      BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order        INT NOT NULL DEFAULT 0,
  specification     JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── memory_stores ────────────────────────────────────────────────────────────
-- Per-agent policy: memory_code (LLM extraction rules) + specification JSON.
CREATE TABLE IF NOT EXISTS memory_stores (
  id                VARCHAR(36) PRIMARY KEY,
  agent_id          VARCHAR(255) UNIQUE NOT NULL,
  name              VARCHAR(255) NOT NULL,
  ref_name          VARCHAR(255) UNIQUE NOT NULL,
  description       TEXT,
  memory_code       TEXT,
  specification     JSONB NOT NULL DEFAULT '{
    "types_enabled": ["semantic", "episodic", "experiential"],
    "retrieval_k": 4,
    "summarize_token_threshold": 1000,
    "embed_model": "text-embedding-3-large"
  }'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── memory_store_types ───────────────────────────────────────────────────────
-- Links each agent store to catalog memory_types by id (all 3 for every agent).
CREATE TABLE IF NOT EXISTS memory_store_types (
  memory_store_id   VARCHAR(36) NOT NULL REFERENCES memory_stores(id) ON DELETE CASCADE,
  memory_type_id    VARCHAR(36) NOT NULL REFERENCES memory_types(id) ON DELETE CASCADE,
  PRIMARY KEY (memory_store_id, memory_type_id)
);

-- ── memory_metadata ──────────────────────────────────────────────────────────
-- Index rows only — content text is stored in Qdrant at the same id.
CREATE TABLE IF NOT EXISTS memory_metadata (
  id                VARCHAR(36) PRIMARY KEY,
  agent_id          VARCHAR(255) NOT NULL,
  memory_type_key   VARCHAR(64) NOT NULL,
  scope             VARCHAR(255) NOT NULL,
  -- Idempotency key for session-end writes (e.g. session_end:{conversationId})
  source_message_id VARCHAR(255),
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active row per (source_message_id, memory_type_key) — retries update same point
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_metadata_idempotency
  ON memory_metadata (source_message_id, memory_type_key)
  WHERE source_message_id IS NOT NULL AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_memory_metadata_agent_scope
  ON memory_metadata (agent_id, scope)
  WHERE is_deleted = FALSE;

-- ── memory_recall_log ────────────────────────────────────────────────────────
-- Audit: which memories were injected during Assemble for each user query.
CREATE TABLE IF NOT EXISTS memory_recall_log (
  id                  VARCHAR(36) PRIMARY KEY,
  agent_id            VARCHAR(255) NOT NULL,
  user_id             VARCHAR(255) NOT NULL,
  conversation_id     VARCHAR(255) NOT NULL,
  user_query          TEXT NOT NULL DEFAULT '',
  memories_injected   JSONB NOT NULL DEFAULT '[]',
  latency_ms          INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_recall_log_agent
  ON memory_recall_log (agent_id, created_at DESC);
