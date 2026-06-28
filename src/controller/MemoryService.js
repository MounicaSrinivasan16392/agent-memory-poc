import { embedText } from "../embeddings.js";
import { config } from "../config.js";

/**
 * Long-term memory orchestration — search, semantic profile CRUD, episodic writes.
 * Joins Postgres metadata with Qdrant content via MemoriesRepository.
 */
class MemoryService {
  /**
   * @param memories Combined Postgres + Qdrant memories repository.
   * @param memoryStores Postgres agent policy store (memory_code, specification).
   */
  constructor(memories, memoryStores) {
    this.memories = memories;
    this.memoryStores = memoryStores;
  }
  memories;
  memoryStores;
  /**
   * Qdrant vector search over episodic and experiential memories.
   * Semantic profile is loaded separately (session start / assemble), not via search.
   *
   * @param agentId Agent whose memories to search.
   * @param userId User scope for episodic memories.
   * @param query User query text (required — empty query returns no hits).
   * @param options.topK Maximum hits to return (default 6).
   * @param options.types Memory types to search (semantic is excluded).
   * @param options.includeShared Whether to include __shared__ experiential scope.
   * @returns Vector-ranked episodic/experiential hits.
   *
   * Used by: ContextAssembler.assemble, clients/js search, grpc/server Search.
   */
  async searchMemories(agentId, userId, query, options) {
    const types = (options?.types ?? config.memory.typesEnabled).filter((t) => t !== "semantic");
    const topK = options?.topK ?? config.memory.retrievalK;
    const includeShared = options?.includeShared ?? types.includes("experiential");
    if (!query.trim() || types.length === 0 || topK <= 0) {
      return [];
    }
    const { embedding } = await embedText(query);
    const vectorHits = await this.memories.vectorSearch(
      agentId,
      userId,
      query,
      topK,
      embedding,
      types,
      includeShared
    );
    return vectorHits.map((h) => ({
      memoryId: h.memory.id,
      type: h.memory.type,
      content: h.memory.content,
      score: h.score
    }));
  }
  /**
   * Read the user's consolidated semantic profile blob.
   * Returns the single semantic profile record loaded at chat start and used
   * as context for session-end consolidation.
   *
   * @param agentId Agent identifier.
   * @param userId User scope.
   * @returns Semantic profile record or null when none exists.
   *
   * Used by: SessionEndHandler.finalizeSession, clients/js via gRPC.
   */
  async getSemanticProfile(agentId, userId) {
    return this.memories.getSemanticProfile(agentId, userId);
  }
  /**
   * Replace the user's semantic profile after session-end consolidation.
   * Overwrites the full profile content rather than merging individual facts so
   * the LLM consolidation output becomes the authoritative semantic state.
   *
   * @param agentId Agent identifier.
   * @param userId User scope.
   * @param content New profile markdown text.
   * @returns Updated profile record from the repository.
   *
   * Used by: SessionEndHandler.finalizeSession.
   */
  async setSemanticProfile(agentId, userId, content) {
    return this.memories.setSemanticProfile(agentId, userId, content);
  }
  /**
   * Persist one episodic session narrative at conversation end.
   * Idempotent on sourceMessageId so re-running session_end updates rather than
   * duplicates the episodic record for the same conversation.
   *
   * @param input Agent, user, conversation ids, and narrative content.
   * @returns True when a record was inserted or updated.
   *
   * Used by: SessionEndHandler.finalizeSession.
   */
  async writeEpisodicSession(input) {
    return this.writeScopedSession({
      ...input,
      scope: input.userId,
      type: "episodic",
      sourceMessageId: `session_end:${input.conversationId}`
    });
  }
  /**
   * Persist a shared experiential insight (PII stripped by session_end LLM).
   * Writes to __shared__ scope so all users benefit from agent-level learnings
   * when experiential memory is enabled for the agent.
   *
   * @param input Agent, conversation ids, and insight content.
   * @returns True when a record was inserted or updated.
   *
   * Used by: SessionEndHandler.finalizeSession.
   */
  async writeExperientialInsight(input) {
    return this.writeScopedSession({
      agentId: input.agentId,
      userId: input.conversationId,
      conversationId: input.conversationId,
      content: input.content,
      scope: "__shared__",
      type: "experiential",
      sourceMessageId: `experiential:${input.conversationId}`
    });
  }
  /**
   * Insert or update a scoped session-derived memory with idempotent sourceMessageId.
   * Shared by episodic and experiential session-end writers to avoid duplicate
   * records when consolidation jobs retry.
   */
  async writeScopedSession(input) {
    const existing = await this.memories.getBySourceMessageId(
      input.agentId,
      input.scope,
      input.sourceMessageId,
      input.type
    );
    if (existing) {
      const updated = await this.memories.updateContent(existing.id, input.content);
      if (updated) {
        const { embedding: embedding2 } = await embedText(updated.content);
        await this.memories.indexToSearch(updated, embedding2);
        return true;
      }
    }
    const record = await this.memories.insert({
      agentId: input.agentId,
      scope: input.scope,
      type: input.type,
      content: input.content,
      sourceMessageId: input.sourceMessageId
    });
    if (!record) return false;
    const { embedding } = await embedText(record.content);
    await this.memories.indexToSearch(record, embedding);
    return true;
  }
  /**
   * Load the agent-specific memory_code LLM policy document.
   * Used by session_end and summarize paths to steer consolidation.
   *
   * @param agentId Agent identifier.
   * @returns memory_code markdown string.
   *
   * Used by: SessionEndHandler.finalizeSession, SummarizeHandler (via job payload).
   */
  async getMemoryCode(agentId) {
    if (!this.memoryStores) {
      throw new Error("[memory] memory stores unavailable - cannot load memory_code");
    }
    const store = await this.memoryStores.ensureDefaultForAgent(agentId);
    if (!store.memoryCode?.trim()) {
      throw new Error(
        `[memory] no memory_code for agent "${agentId}" - run register:agents or RegisterAgent gRPC first`
      );
    }
    return store.memoryCode;
  }
}
export {
  MemoryService
};
