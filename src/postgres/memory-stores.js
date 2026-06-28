/** Per-agent memory store rows — policy specification and memory_code. */
import { config } from "../config.js";
import { getPool } from "./client.js";
import { newId } from "../utils/id.js";
import { MemoryTypesDb } from "./memory-types.js";

const DEFAULT_SPEC = {
  types_enabled: config.memory.typesEnabled,
  retrieval_k: config.memory.retrievalK,
  summarize_token_threshold: config.memory.summarizeTokenThreshold
};

class MemoryStoresDb {

  typesDb = new MemoryTypesDb();

  async getForAgent(agentId) {
    const { rows } = await getPool().query(
      `SELECT id, agent_id, name, ref_name, description, memory_code,
              specification, created_at, updated_at
       FROM memory_stores
       WHERE agent_id = $1
       LIMIT 1`,
      [agentId]
    );
    if (!rows[0]) return null;
    return rowToRecord(rows[0]);
  }

  async ensureDefaultForAgent(agentId, _systemPrompt) {
    const existing = await this.getForAgent(agentId);
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
        `Default memory - ${agentId}`,
        refName,
        null,
        JSON.stringify(DEFAULT_SPEC)
      ]
    );
    await this.typesDb.linkAllTypesToStore(storeId);
    return await this.getForAgent(agentId);
  }

  async updateMemoryCode(storeId, memoryCode) {
    await getPool().query(
      `UPDATE memory_stores SET memory_code = $2, updated_at = NOW() WHERE id = $1`,
      [storeId, memoryCode]
    );
  }
}

function rowToRecord(row) {
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
  MemoryStoresDb
};
