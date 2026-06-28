/** Postgres CRUD for memory_metadata — id is the Qdrant point id. */
import { getPool } from "./client.js";
import { newId } from "../utils/id.js";

class MemoryMetadataDb {
  async upsertProfile(input) {
    const existing = await this.getProfile(input.agentId, input.scope, input.memoryTypeKey);
    if (existing) {
      const { rows: rows2 } = await getPool().query(
        `UPDATE memory_metadata
         SET source_message_id = COALESCE($2, source_message_id),
             updated_at = NOW()
         WHERE id = $1 AND is_deleted = FALSE
         RETURNING *`,
        [existing.id, input.sourceMessageId ?? null]
      );
      return rowToMetadata(rows2[0]);
    }
    const id = newId();
    const { rows } = await getPool().query(
      `INSERT INTO memory_metadata (
         id, agent_id, memory_type_key, scope, source_message_id
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        id,
        input.agentId,
        input.memoryTypeKey,
        input.scope,
        input.sourceMessageId ?? null
      ]
    );
    return rowToMetadata(rows[0]);
  }

  async insert(input) {
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
        [
          id,
          input.agentId,
          input.memoryTypeKey,
          input.scope,
          input.sourceMessageId ?? null
        ]
      );
      if (!rows[0]) return null;
      return rowToMetadata(rows[0]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("idx_memory_metadata_idempotency")) return null;
      throw err;
    }
  }

  async getProfile(agentId, scope, memoryTypeKey) {
    const { rows } = await getPool().query(
      `SELECT * FROM memory_metadata
       WHERE agent_id = $1 AND scope = $2 AND memory_type_key = $3
         AND is_deleted = FALSE
       LIMIT 1`,
      [agentId, scope, memoryTypeKey]
    );
    return rows[0] ? rowToMetadata(rows[0]) : null;
  }

  async getById(id) {
    const { rows } = await getPool().query(
      `SELECT * FROM memory_metadata WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    return rows[0] ? rowToMetadata(rows[0]) : null;
  }

  async getBySourceMessageId(agentId, scope, sourceMessageId, memoryTypeKey) {
    const { rows } = await getPool().query(
      `SELECT * FROM memory_metadata
       WHERE agent_id = $1 AND scope = $2 AND source_message_id = $3
         AND memory_type_key = $4 AND is_deleted = FALSE
       LIMIT 1`,
      [agentId, scope, sourceMessageId, memoryTypeKey]
    );
    return rows[0] ? rowToMetadata(rows[0]) : null;
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
export {
  MemoryMetadataDb
};
