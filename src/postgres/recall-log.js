/** Audit log of memories injected into assemble (memory_recall_log table). */
import { getPool } from "./client.js";
import { newId } from "../utils/id.js";
class RecallLogDb {
  /**
   * Record injected memories for a user query.
   *
   * Serializes memory hit arrays to JSONB and stores latency_ms
   * so operators can inspect what context the model actually received.
   *
   * @param entry - Full recall event payload (agent, user, query, hits, latency).
   * Used by: ContextAssembler.assemble (non-blocking append).
   */
  async append(entry) {
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
}
export {
  RecallLogDb
};
