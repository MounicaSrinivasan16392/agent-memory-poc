/**
 * Single Postgres access layer for the memory platform.
 *
 * Tables touched:
 *   memory_metadata   — index rows (id matches Qdrant point id; no content text here)
 *   memory_stores     — per-agent policy + memory_code
 *   memory_recall_log — assemble audit trail
 *   memory_types      — global catalog seeded at agent registration
 *
 * Uses connection pool from postgres/client.js — this class does not manage connections.
 */
import { config } from "../config.js";
import { getPool } from "../postgres/client.js";
import { newId } from "../utils/id.js";

const DEFAULT_SPEC = {
  types_enabled: config.memory.typesEnabled,
  retrieval_k: config.memory.retrievalK,
  summarize_token_threshold: config.memory.summarizeTokenThreshold
};

const DEFAULT_MEMORY_TYPES = [
  { typeKey: "semantic", displayName: "Semantic facts", scopeMode: "user", writeTrigger: "session_end", embedOnWrite: false, profileMode: true, sortOrder: 1 },
  { typeKey: "episodic", displayName: "Session events", scopeMode: "user", writeTrigger: "session_end", embedOnWrite: true, profileMode: false, sortOrder: 2 },
  { typeKey: "experiential", displayName: "Shared insights", scopeMode: "shared", writeTrigger: "session_end", embedOnWrite: true, profileMode: false, sortOrder: 3 }
];

class PostgresStore {

  // ── memory_metadata ───────────────────────────────────────────────────────
  // Metadata only — content lives in Qdrant. memory_metadata.id = Qdrant point id.

  /** Upsert the single semantic profile row per (agent, user). */
  async upsertProfileMetadata(input) {
    const existing = await this.getProfileMetadata(input.agentId, input.scope, input.memoryTypeKey);
    if (existing) {
      const { rows } = await getPool().query(
        `UPDATE memory_metadata
         SET source_message_id = COALESCE($2, source_message_id),
             updated_at = NOW()
         WHERE id = $1 AND is_deleted = FALSE
         RETURNING *`,
        [existing.id, input.sourceMessageId ?? null]
      );
      return rowToMetadata(rows[0]);
    }
    const id = newId();
    const { rows } = await getPool().query(
      `INSERT INTO memory_metadata (
         id, agent_id, memory_type_key, scope, source_message_id
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, input.agentId, input.memoryTypeKey, input.scope, input.sourceMessageId ?? null]
    );
    return rowToMetadata(rows[0]);
  }

  /** Insert episodic/experiential row. Returns null on idempotent conflict (same source_message_id). */
  async insertMemoryMetadata(input) {
    const id = newId();
    try {
      const { rows } = await getPool().query(
        `INSERT INTO memory_metadata (
           id, agent_id, memory_type_key, scope, source_message_id
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_message_id, memory_type_key)
           WHERE source_message_id IS NOT NULL AND is_deleted = FALSE
         DO NOTHING
         RETURNING *`,
        [id, input.agentId, input.memoryTypeKey, input.scope, input.sourceMessageId ?? null]
      );
      if (!rows[0]) return null;
      return rowToMetadata(rows[0]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("idx_memory_metadata_idempotency")) return null;
      throw err;
    }
  }

  /** Profile-mode lookup — one row per (agent, scope, type) e.g. semantic per user. */
  async getProfileMetadata(agentId, scope, memoryTypeKey) {
    const { rows } = await getPool().query(
      `SELECT * FROM memory_metadata
       WHERE agent_id = $1 AND scope = $2 AND memory_type_key = $3
         AND is_deleted = FALSE
       LIMIT 1`,
      [agentId, scope, memoryTypeKey]
    );
    return rows[0] ? rowToMetadata(rows[0]) : null;
  }

  async getMemoryById(id) {
    const { rows } = await getPool().query(
      `SELECT * FROM memory_metadata WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    return rows[0] ? rowToMetadata(rows[0]) : null;
  }

  /** Idempotency lookup for session-end writes (episodic, experiential). */
  async getMemoryBySourceMessageId(agentId, scope, sourceMessageId, memoryTypeKey) {
    const { rows } = await getPool().query(
      `SELECT * FROM memory_metadata
       WHERE agent_id = $1 AND scope = $2 AND source_message_id = $3
         AND memory_type_key = $4 AND is_deleted = FALSE
       LIMIT 1`,
      [agentId, scope, sourceMessageId, memoryTypeKey]
    );
    return rows[0] ? rowToMetadata(rows[0]) : null;
  }

  // ── memory_stores (agent policy + memory_code) ────────────────────────────

  async getAgentStore(agentId) {
    const { rows } = await getPool().query(
      `SELECT id, agent_id, name, ref_name, description, memory_code,
              specification, created_at, updated_at
       FROM memory_stores
       WHERE agent_id = $1
       LIMIT 1`,
      [agentId]
    );
    if (!rows[0]) return null;
    return rowToAgentStore(rows[0]);
  }

  /** Create agent store row + link memory_types if missing. Called at registration. */
  async ensureAgentStore(agentId, _systemPrompt) {
    const existing = await this.getAgentStore(agentId);
    if (existing) return existing;
    const storeId = newId();
    const refName = `default_${agentId}`;
    await getPool().query(
      `INSERT INTO memory_stores (
         id, agent_id, name, ref_name, memory_code, specification
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        storeId,
        agentId,
        `Default memory — ${agentId}`,
        refName,
        null,
        JSON.stringify(DEFAULT_SPEC)
      ]
    );
    await this.linkTypesToStore(storeId);
    return await this.getAgentStore(agentId);
  }

  async updateMemoryCode(storeId, memoryCode) {
    await getPool().query(
      `UPDATE memory_stores SET memory_code = $2, updated_at = NOW() WHERE id = $1`,
      [storeId, memoryCode]
    );
  }

  // ── memory_recall_log ─────────────────────────────────────────────────────

  /** Audit log — what memories were injected into assemble for a user query. */
  async appendRecallLog(entry) {
    await getPool().query(
      `INSERT INTO memory_recall_log (
        id, agent_id, user_id, conversation_id, user_query,
        memories_injected, latency_ms
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        newId(),
        entry.agentId,
        entry.userId,
        entry.conversationId,
        entry.userQuery,
        JSON.stringify(entry.memories),
        entry.latencyMs
      ]
    );
  }

  // ── memory_types (catalog seeding) ────────────────────────────────────────

  /** Seed global memory_types + link all types to a new agent store. */
  async linkTypesToStore(memoryStoreId) {
    for (const t of DEFAULT_MEMORY_TYPES) {
      await getPool().query(
        `INSERT INTO memory_types (
          id, type_key, display_name, scope_mode,
          write_trigger, embed_on_write, profile_mode, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (type_key) DO NOTHING`,
        [
          newId(),
          t.typeKey,
          t.displayName,
          t.scopeMode,
          t.writeTrigger,
          t.embedOnWrite,
          t.profileMode,
          t.sortOrder
        ]
      );
    }
    await getPool().query(
      `INSERT INTO memory_store_types (memory_store_id, memory_type_id)
       SELECT $1, id FROM memory_types ORDER BY sort_order ASC, type_key ASC
       ON CONFLICT DO NOTHING`,
      [memoryStoreId]
    );
  }
}

function rowToMetadata(row) {
  return {
    id: String(row["id"]),
    agentId: String(row["agent_id"]),
    memoryTypeKey: String(row["memory_type_key"]),
    scope: String(row["scope"]),
    sourceMessageId: row["source_message_id"] ? String(row["source_message_id"]) : null,
    isDeleted: Boolean(row["is_deleted"]),
    createdAt: new Date(String(row["created_at"])),
    updatedAt: new Date(String(row["updated_at"]))
  };
}

function rowToAgentStore(row) {
  const spec = row["specification"] ?? DEFAULT_SPEC;
  return {
    id: String(row["id"]),
    agentId: String(row["agent_id"]),
    name: String(row["name"]),
    refName: String(row["ref_name"]),
    memoryCode: row["memory_code"] != null ? String(row["memory_code"]) : null,
    specification: {
      typesEnabled: spec["types_enabled"] ?? config.memory.typesEnabled,
      retrievalK: Number(spec["retrieval_k"] ?? config.memory.retrievalK),
      summarizeTokenThreshold: Number(spec["summarize_token_threshold"] ?? config.memory.summarizeTokenThreshold)
    }
  };
}

export {
  PostgresStore
};
