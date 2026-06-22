/** Ensures per-agent OpenSearch indices exist (kNN mapping for embeddings). */
import { config } from "../config.js";
const MEMORY_FIELDS = {
  memory_id: { type: "keyword" },
  agent_id: { type: "keyword" },
  scope: { type: "keyword" },
  type: { type: "keyword" },
  content: { type: "text" },
  importance: { type: "float" },
  valid_to: { type: "date" },
  is_deleted: { type: "boolean" },
  created_at: { type: "date" },
  updated_at: { type: "date" }
};
function agentIndex(agentId, suffix) {
  return `${config.opensearch.indexPrefix}${agentId}${suffix}`;
}
function memoriesIndex(agentId) {
  return agentIndex(agentId, config.opensearch.memoriesIndexSuffix);
}
class IndexManager {
  constructor(client) {
    this.client = client;
  }
  client;
  ensured = /* @__PURE__ */ new Set();
  /**
   * Ensure the memories index exists with kNN mapping for embeddings.
   *
   * Creates the index on first access with MEMORY_FIELDS plus an HNSW
   * embedding vector when missing; no-op when already ensured.
   *
   * @param agentId - Agent whose memories index to ensure.
   * Used by: OpenSearchMemoriesStore (index, hybridSearch, getContent).
   */
  ensureMemoriesIndex(agentId) {
    return this.ensure(memoriesIndex(agentId), MEMORY_FIELDS);
  }
  /** Idempotent index create with process-local cache and race-safe exists handling. */
  async ensure(index, fields) {
    if (this.ensured.has(index)) return;
    try {
      const { body: exists } = await this.client.indices.exists({ index });
      if (exists) {
        this.ensured.add(index);
        return;
      }
    } catch {
    }
    try {
      await this.client.indices.create({
        index,
        body: {
          settings: {
            index: {
              knn: true,
              number_of_shards: config.opensearch.numberOfShards,
              number_of_replicas: config.opensearch.numberOfReplicas
            }
          },
          mappings: {
            properties: {
              ...fields,
              embedding: {
                type: "knn_vector",
                dimension: config.embeddings.dimensions,
                method: {
                  name: "hnsw",
                  space_type: "cosinesimil",
                  engine: "faiss",
                  parameters: { ef_construction: 128, m: 16 }
                }
              }
            }
          }
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("resource_already_exists")) {
        this.ensured.add(index);
        return;
      }
      throw new Error(`[memory] faiss index create failed for ${index}: ${msg}`);
    }
    this.ensured.add(index);
  }
}
export {
  IndexManager,
  memoriesIndex
};
