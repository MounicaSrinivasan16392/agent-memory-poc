/** Qdrant point upsert + vector search for long-term memories (one collection per agent). */
import { config } from "../config.js";
import { agentCollectionName } from "./collection-manager.js";

class QdrantMemoriesStore {
  constructor(client, collectionManager) {
    this.client = client;
    this.collectionManager = collectionManager;
  }
  client;
  collectionManager;

  /** Create the per-agent Qdrant collection if it does not exist yet. */
  async ensureCollection(agentId) {
    return this.collectionManager.ensureAgentCollection(agentId);
  }

  async getContent(agentId, memoryId) {
    const collection = agentCollectionName(agentId);
    try {
      const points = await this.client.retrieve(collection, {
        ids: [memoryId],
        with_payload: true
      });
      const payload = points[0]?.payload;
      if (!payload || payload.is_deleted) return null;
      return String(payload.content ?? "");
    } catch {
      return null;
    }
  }

  async index(doc) {
    await this.collectionManager.ensureAgentCollection(doc.agentId);
    const collection = agentCollectionName(doc.agentId);
    const now = new Date().toISOString();
    const vector = doc.embedding ?? zeroVector(config.embeddings.dimensions);
    try {
      await this.client.upsert(collection, {
        wait: true,
        points: [
          {
            id: doc.memoryId,
            vector,
            payload: {
              memory_id: doc.memoryId,
              agent_id: doc.agentId,
              scope: doc.scope,
              type: doc.type,
              content: doc.content,
              is_deleted: false,
              created_at: now,
              updated_at: now
            }
          }
        ]
      });
    } catch (err) {
      const detail = err?.data?.status?.error ?? (err instanceof Error ? err.message : String(err));
      throw new Error(`[memory] Qdrant upsert failed for ${doc.memoryId}: ${detail}`);
    }
  }

  /**
   * Vector similarity search with payload filters.
   */
  async vectorSearch(agentId, userId, _query, topK, queryEmbedding, types, includeShared = false) {
    if (!queryEmbedding?.length) return [];
    await this.collectionManager.ensureAgentCollection(agentId);
    const collection = agentCollectionName(agentId);
    const scopes = includeShared ? [userId, "__shared__"] : [userId];
    const filter = buildFilter(scopes, types);
    const results = await this.client.search(collection, {
      vector: queryEmbedding,
      limit: topK,
      filter,
      with_payload: true
    });
    return results.map((r) => ({
      memory: payloadToMemory(r.payload ?? {}, r.id),
      score: r.score ?? 0
    }));
  }
}

function zeroVector(dimensions) {
  return Array.from({ length: dimensions }, () => 0);
}

function buildFilter(scopes, types) {
  const must = [
    { key: "is_deleted", match: { value: false } },
    { key: "scope", match: { any: scopes } }
  ];
  if (types?.length) {
    must.push({ key: "type", match: { any: types } });
  }
  return { must };
}

function payloadToMemory(payload, pointId) {
  const p = payload ?? {};
  return {
    id: String(p.memory_id ?? pointId),
    agentId: String(p.agent_id ?? ""),
    scope: String(p.scope ?? ""),
    type: p.type ?? "semantic",
    content: String(p.content ?? ""),
    isDeleted: Boolean(p.is_deleted)
  };
}

export {
  QdrantMemoriesStore
};
