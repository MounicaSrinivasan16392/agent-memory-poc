import { newId } from "../utils/id.js";

/**
 * Combined long-term memory repository — Postgres metadata + OpenSearch content.
 * Semantic profiles use profile mode (one row per user); episodic is append-only.
 */
class PostgresOpenSearchMemories {
  constructor(meta, os) {
    this.meta = meta;
    this.os = os;
  }
  meta;
  os;
  /**
   * Read the semantic profile blob for an agent/user scope.
   *
   * Semantic memories use profile mode (one row per scope) rather than append-only
   * episodic rows. Content lives in OpenSearch; metadata in Postgres.
   *
   * @param agentId - Agent owning the memory store.
   * @param scope - User or shared scope key (typically userId).
   * @returns Full MemoryRecord or null if no profile exists.
   * Used by: MemoryService.searchMemories, getSemanticProfile, setSemanticProfile.
   */
  async getSemanticProfile(agentId, scope) {
    return this.getProfileRecord(agentId, scope, "semantic");
  }
  /**
   * Replace the entire semantic profile content for a scope.
   *
   * Trims whitespace and no-ops on empty content. Overwrites both Postgres
   * metadata and the OpenSearch document for the profile.
   *
   * @param agentId - Agent owning the profile.
   * @param scope - User scope key.
   * @param content - New profile text (bullet facts, prose, etc.).
   * @param importance - Optional importance override (defaults to existing or 0.5).
   * @returns Updated MemoryRecord or null when content is empty.
   * Used by: MemoryService.setSemanticProfile.
   */
  async setSemanticProfile(agentId, scope, content, importance) {
    const trimmed = content.trim();
    if (!trimmed) return null;
    return this.writeProfile(agentId, scope, "semantic", trimmed, importance);
  }
  /**
   * Create a new episodic or experiential memory in Postgres and OpenSearch.
   *
   * Allocates a new OpenSearch doc id, inserts metadata (with idempotency on
   * source_message_id when present), indexes content, and returns a hydrated record.
   *
   * @param input - Agent, scope, type, content, importance, optional sourceMessageId.
   * @returns MemoryRecord or null when Postgres insert is deduplicated/skipped.
   * Used by: MemoryService.writeScopedSession.
   */
  async insert(input) {
    const docId = newId();
    const meta = await this.meta.insert({
      agentId: input.agentId,
      memoryTypeKey: input.type,
      scope: input.scope,
      opensearchDocId: docId,
      importance: input.importance,
      sourceMessageId: input.sourceMessageId
    });
    if (!meta) return null;
    await this.os.index({
      memoryId: docId,
      agentId: input.agentId,
      scope: input.scope,
      type: input.type,
      content: input.content,
      importance: meta.importance
    });
    return toMemoryRecord(meta, input.content);
  }
  /**
   * Update memory content and optionally importance in both stores.
   *
   * Looks up metadata by Postgres id, patches importance when provided, re-indexes
   * the OpenSearch document, and returns the updated MemoryRecord.
   *
   * @param memoryId - Postgres memory_metadata id.
   * @param content - New searchable content.
   * @param importance - Optional new importance score.
   * @returns Updated MemoryRecord or null when metadata row is missing.
   * Used by: MemoryService.writeScopedSession.
   */
  async updateContent(memoryId, content, importance) {
    const meta = await this.meta.getById(memoryId);
    if (!meta) return null;
    if (importance !== void 0) {
      await this.meta.updateImportance(meta.id, importance);
    }
    await this.os.index({
      memoryId: meta.opensearchDocId,
      agentId: meta.agentId,
      scope: meta.scope,
      type: meta.memoryTypeKey,
      content,
      importance: importance ?? meta.importance
    });
    return toMemoryRecord(
      { ...meta, importance: importance ?? meta.importance },
      content
    );
  }
  /**
   * Idempotency lookup for session-end episodic writes.
   *
   * Prevents duplicate episodic rows when session-end retries the
   * same sourceMessageId for a given agent/scope/type combination.
   *
   * @param agentId - Agent id.
   * @param scope - User scope.
   * @param sourceMessageId - Upstream message id used as idempotency key.
   * @param type - Memory type (typically episodic).
   * @returns Existing MemoryRecord or null.
   * Used by: MemoryService.writeScopedSession.
   */
  async getBySourceMessageId(agentId, scope, sourceMessageId, type) {
    const meta = await this.meta.getBySourceMessageId(agentId, scope, sourceMessageId, type);
    if (!meta) return null;
    const content = await this.os.getContent(agentId, meta.opensearchDocId);
    if (!content) return null;
    return toMemoryRecord(meta, content);
  }
  /**
   * Run hybrid BM25 + kNN search with optional type and shared-scope filters.
   *
   * Passes through to OpenSearchMemoriesStore.hybridSearch — the primary retrieval
   * path for context assembly and semantic recall.
   *
   * @param agentId - Agent id.
   * @param userId - Primary user scope (and BM25/kNN filter scope).
   * @param query - Natural-language query text.
   * @param topK - Maximum hits to return.
   * @param embedding - Optional query vector for kNN leg.
   * @param types - Optional memory type filter.
   * @param includeShared - When true, also search __shared__ scope.
   * @returns Ranked MemorySearchHit array with score breakdown.
   * Used by: MemoryService.searchMemories.
   */
  hybridSearch(agentId, userId, query, topK, embedding, types, includeShared) {
    return this.os.hybridSearch(agentId, userId, query, topK, embedding, types, includeShared);
  }
  /**
   * Re-index an existing record in OpenSearch, optionally attaching an embedding.
   *
   * Used after Postgres writes when embeddings are computed asynchronously or
   * when refreshing search vectors without changing metadata.
   *
   * @param record - MemoryRecord with content and embeddingRef (OpenSearch doc id).
   * @param embedding - Optional vector to store on the document.
   * Used by: MemoryService.writeScopedSession.
   */
  async indexToSearch(record, embedding) {
    await this.os.index({
      memoryId: record.embeddingRef ?? record.id,
      agentId: record.agentId,
      scope: record.scope,
      type: record.type,
      content: record.content,
      importance: record.importance,
      embedding: embedding ?? void 0
    });
  }
  /** Load profile-mode memory (semantic) by joining Postgres metadata with OS content. */
  async getProfileRecord(agentId, scope, typeKey) {
    const meta = await this.meta.getProfile(agentId, scope, typeKey);
    if (!meta) return null;
    const content = await this.os.getContent(agentId, meta.opensearchDocId);
    if (!content?.trim()) return null;
    return toMemoryRecord(meta, content);
  }
  /** Upsert profile content in OpenSearch then sync Postgres metadata row. */
  async writeProfile(agentId, scope, typeKey, content, importance) {
    const existing = await this.meta.getProfile(agentId, scope, typeKey);
    const docId = existing?.opensearchDocId ?? newId();
    await this.os.index({
      memoryId: docId,
      agentId,
      scope,
      type: typeKey,
      content,
      importance: importance ?? existing?.importance ?? 0.5
    });
    const meta = await this.meta.upsertProfile({
      agentId,
      memoryTypeKey: typeKey,
      scope,
      opensearchDocId: docId,
      importance: importance ?? existing?.importance
    });
    return toMemoryRecord(meta, content);
  }
}
function toMemoryRecord(meta, content) {
  return {
    id: meta.id,
    agentId: meta.agentId,
    scope: meta.scope,
    type: meta.memoryTypeKey,
    content,
    importance: meta.importance,
    validFrom: meta.createdAt,
    validTo: null,
    supersededBy: null,
    sourceMessageId: meta.sourceMessageId,
    embeddingRef: meta.opensearchDocId,
    isDeleted: meta.isDeleted
  };
}
export {
  PostgresOpenSearchMemories
};
