/**
 * Single Qdrant access layer for long-term memory content.
 *
 * One collection per agent: {QDRANT_COLLECTION_PREFIX}{agentId}
 * Point id = memory_metadata.id (UUID) in Postgres.
 *
 * Payload fields: memory_id, agent_id, scope, type, content, is_deleted
 * Semantic profiles use a zero vector; episodic/experiential use real embeddings.
 */
import { config } from "../config.js";

/** Sanitize agent id for use as a Qdrant collection name. */
function agentCollectionName(agentId) {
  const safe = String(agentId).replace(/[^a-zA-Z0-9_]/g, "_");
  return `${config.qdrant.collectionPrefix}${safe}`;
}

class QdrantStore {
  constructor(client) {
    this.client = client;
    /** In-process cache — skip repeated getCollections checks per agent. */
    this.ensured = new Set();
  }
  client;
  ensured;

  /** Create collection + payload indexes if missing. Returns collection name. */
  async ensureCollection(agentId) {
    const name = agentCollectionName(agentId);
    if (this.ensured.has(name)) return name;

    const collections = await this.client.getCollections();
    const exists = collections.collections?.some((c) => c.name === name);
    if (!exists) {
      await this.client.createCollection(name, {
        vectors: {
          size: config.embeddings.dimensions,
          distance: "Cosine"
        }
      });
      await this.client.createPayloadIndex(name, {
        field_name: "scope",
        field_schema: "keyword"
      });
      await this.client.createPayloadIndex(name, {
        field_name: "type",
        field_schema: "keyword"
      });
      await this.client.createPayloadIndex(name, {
        field_name: "is_deleted",
        field_schema: "bool"
      });
    }
    this.ensured.add(name);
    return name;
  }

  /** Read content text for a point by postgres metadata id. */
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

  /**
   * Upsert one memory point. Pass embedding for episodic/experiential;
   * omit embedding for semantic (zero vector used).
   */
  async upsertPoint(doc) {
    await this.ensureCollection(doc.agentId);
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
   * Cosine similarity search filtered by scope and type.
   * includeShared=true adds __shared__ scope for experiential memories.
   */
  async vectorSearch(agentId, userId, topK, queryEmbedding, types, includeShared = false) {
    if (!queryEmbedding?.length) return [];
    await this.ensureCollection(agentId);
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
  QdrantStore,
  agentCollectionName
};
