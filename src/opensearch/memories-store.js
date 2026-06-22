/** OpenSearch document index + hybrid BM25/kNN search for long-term memories. */
import { config } from "../config.js";
import { memoriesIndex } from "./index-manager.js";
class OpenSearchMemoriesStore {
  constructor(client, indexManager) {
    this.client = client;
    this.indexManager = indexManager;
  }
  client;
  indexManager;
  /**
   * Fetch raw document content by OpenSearch document id.
   *
   * Returns null when the document is missing, deleted, or when get throws
   * (e.g. index not yet populated) — callers treat null as "no content".
   *
   * @param agentId - Agent id (selects per-agent index).
   * @param docId - OpenSearch document _id (opensearch_doc_id from Postgres).
   * @returns Content string or null.
   * Used by: PostgresOpenSearchMemories (updateContent, getProfileRecord).
   */
  async getContent(agentId, docId) {
    const index = memoriesIndex(agentId);
    try {
      const { body } = await this.client.get({ index, id: docId });
      const src = body._source;
      if (!src || src["is_deleted"]) return null;
      return String(src["content"] ?? "");
    } catch {
      return null;
    }
  }
  /**
   * Upsert a memory document with optional embedding vector.
   *
   * Ensures the agent index exists, writes all mapped fields, sets is_deleted
   * false, and refreshes so subsequent searches see the update immediately.
   *
   * @param doc - MemoryIndexDoc with content and optional embedding.
   * Used by: PostgresOpenSearchMemories (insert, updateContent, writeProfile, indexToSearch).
   */
  async index(doc) {
    await this.indexManager.ensureMemoriesIndex(doc.agentId);
    const index = memoriesIndex(doc.agentId);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await this.client.index({
      index,
      id: doc.memoryId,
      body: {
        memory_id: doc.memoryId,
        agent_id: doc.agentId,
        scope: doc.scope,
        type: doc.type,
        content: doc.content,
        importance: doc.importance,
        is_deleted: false,
        created_at: now,
        updated_at: now,
        ...doc.embedding ? { embedding: doc.embedding } : {}
      },
      refresh: true
    });
  }
  /**
   * Hybrid BM25 + kNN search with importance-weighted score fusion.
   *
   * Runs BM25 multi_match on content, optionally merges kNN hits on embedding,
   * normalizes scores, adds importance boost from config.hybrid weights, and
   * returns top-K MemorySearchHit results.
   *
   * @param agentId - Agent id (index selector).
   * @param userId - Primary scope; included in filter (plus __shared__ when includeShared).
   * @param query - Natural-language query for BM25.
   * @param topK - Maximum hits after fusion and sort.
   * @param queryEmbedding - Optional query vector; skips kNN leg when null.
   * @param types - Optional memory type filter.
   * @param includeShared - When true, search userId and __shared__ scopes.
   * @returns Ranked MemorySearchHit array with bm25/vector/score breakdown.
   * Used by: PostgresOpenSearchMemories.hybridSearch; MemoryService.searchMemories.
   */
  async hybridSearch(agentId, userId, query, topK, queryEmbedding, types, includeShared = false) {
    await this.indexManager.ensureMemoriesIndex(agentId);
    const index = memoriesIndex(agentId);
    const scopes = includeShared ? [userId, "__shared__"] : [userId];
    const filterClauses = buildScopeFilter(scopes, types);
    const { body: bm25Body } = await this.client.search({
      index,
      body: {
        size: topK * 2,
        query: {
          bool: {
            must: [{ multi_match: { query, fields: ["content"], fuzziness: "AUTO" } }],
            filter: filterClauses
          }
        }
      }
    });
    const merged = /* @__PURE__ */ new Map();
    const bm25Hits = bm25Body.hits?.hits ?? [];
    for (const h of bm25Hits) {
      merged.set(h._id, {
        memory: sourceToMemory(h._source, h._id),
        score: 0,
        bm25Score: h._score ?? 0,
        vectorScore: 0
      });
    }
    if (queryEmbedding) {
      try {
        const { body: knnBody } = await this.client.search({
          index,
          body: {
            size: topK * 2,
            query: {
              bool: {
                must: [{ knn: { embedding: { vector: queryEmbedding, k: topK * 2 } } }],
                filter: filterClauses
              }
            }
          }
        });
        const knnHits = knnBody.hits?.hits ?? [];
        for (const h of knnHits) {
          const existing = merged.get(h._id);
          if (existing) {
            existing.vectorScore = h._score ?? 0;
          } else {
            merged.set(h._id, {
              memory: sourceToMemory(h._source, h._id),
              score: 0,
              bm25Score: 0,
              vectorScore: h._score ?? 0
            });
          }
        }
      } catch {
      }
    }
    const maxBm25 = Math.max(...[...merged.values()].map((h) => h.bm25Score), 1e-3);
    const maxVector = Math.max(...[...merged.values()].map((h) => h.vectorScore), 1e-3);
    const { bm25Weight, vectorWeight, importanceWeight } = config.hybrid;
    return [...merged.values()].map((h) => ({
      ...h,
      score: bm25Weight * (h.bm25Score / maxBm25) + vectorWeight * (h.vectorScore / maxVector) + importanceWeight * h.memory.importance
    })).sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
function buildScopeFilter(scopes, types) {
  const clauses = [
    { terms: { scope: scopes } },
    { term: { is_deleted: false } },
    {
      bool: {
        should: [
          { range: { valid_to: { gt: "now" } } },
          { bool: { must_not: { exists: { field: "valid_to" } } } }
        ]
      }
    }
  ];
  if (types?.length) clauses.push({ terms: { type: types } });
  return clauses;
}
function sourceToMemory(src, fallbackId) {
  return {
    id: String(src["memory_id"] ?? fallbackId),
    agentId: String(src["agent_id"] ?? ""),
    scope: String(src["scope"] ?? ""),
    type: src["type"] ?? "semantic",
    content: String(src["content"] ?? ""),
    importance: Number(src["importance"] ?? 0.5),
    validFrom: new Date(String(src["created_at"] ?? Date.now())),
    validTo: src["valid_to"] ? new Date(String(src["valid_to"])) : null,
    supersededBy: null,
    sourceMessageId: null,
    embeddingRef: String(src["memory_id"] ?? fallbackId),
    isDeleted: Boolean(src["is_deleted"])
  };
}
export {
  OpenSearchMemoriesStore
};
