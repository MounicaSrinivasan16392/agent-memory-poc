import { embedText } from "../embeddings.js";
import { scoreSemanticProfile } from "../utils/semantic-profile.js";

/**
 * Long-term memory orchestration — search, semantic profile CRUD, episodic writes.
 * Joins Postgres metadata with OpenSearch content via MemoriesRepository.
 */
class MemoryService {
  /**
   * @param memories Combined Postgres + OpenSearch memories repository.
   * @param memoryStores Postgres agent policy store (memory_code, specification).
   */
  constructor(memories, memoryStores) {
    this.memories = memories;
    this.memoryStores = memoryStores;
  }
  memories;
  memoryStores;
  /**
   * Hybrid semantic profile + OpenSearch vector/BM25 search.
   * Semantic profile is always included when it exists; score ranks against episodic hits.
   *
   * @param agentId Agent whose memories to search.
   * @param userId User scope for semantic and episodic memories.
   * @param query User query text (empty returns semantic profile only).
   * @param options.topK Maximum hits to return (default 6).
   * @param options.types Memory types to include (default ['semantic']).
   * @param options.includeShared Whether to include __shared__ experiential scope.
   * @returns Ranked memory hits sorted by score, truncated to topK.
   *
   * Used by: ContextAssembler.assemble, clients/js search, grpc/server Search.
   */
  async searchMemories(agentId, userId, query, options) {
    const types = options?.types ?? ["semantic"];
    const topK = options?.topK ?? 6;
    const includeShared = options?.includeShared ?? types.includes("experiential");
    const hits = [];
    if (types.includes("semantic")) {
      const profile = await this.memories.getSemanticProfile(agentId, userId);
      if (profile?.content.trim()) {
        const score = query.trim() ? scoreSemanticProfile(profile.content, query) : 1;
        hits.push({
          memoryId: profile.id,
          type: "semantic",
          content: profile.content,
          score: score || 1
        });
      }
    }
    const osTypes = types.filter((t) => t !== "semantic");
    if (osTypes.length > 0 && query.trim()) {
      const { embedding } = await embedText(query);
      const osHits = await this.memories.hybridSearch(
        agentId,
        userId,
        query,
        topK,
        embedding,
        osTypes,
        includeShared
      );
      hits.push(
        ...osHits.map((h) => ({
          memoryId: h.memory.id,
          type: h.memory.type,
          content: h.memory.content,
          score: h.score
        }))
      );
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }
  /**
   * Load per-agent memory policy for assemble and session_end.
   * Merges Postgres store specification with enabled memory types and applies
   * defaults when memoryStores is unavailable (local degraded mode).
   *
   * @param agentId Agent identifier.
   * @returns Resolved MemoryConfig with types and retrieval settings.
   *
   * Used by: ContextAssembler.assemble, SessionEndHandler.
   */
  async getMemoryConfig(agentId) {
    if (!this.memoryStores) {
      return { typesEnabled: ["semantic"], retrievalK: 6 };
    }
    const store = await this.memoryStores.ensureDefaultForAgent(agentId);
    return {
      ...store.specification,
      typesEnabled: store.specification.typesEnabled ?? ["semantic", "episodic", "experiential"],
      experientialEnabled: store.specification.experientialEnabled !== false
    };
  }
  /**
   * Read the user's consolidated semantic profile blob.
   * Returns the single semantic profile record used for keyword scoring in search
   * and as context for session-end consolidation.
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
   * @param importance Optional importance score for the profile record.
   * @returns Updated profile record from the repository.
   *
   * Used by: SessionEndHandler.finalizeSession.
   */
  async setSemanticProfile(agentId, userId, content, importance) {
    return this.memories.setSemanticProfile(agentId, userId, content, importance);
  }
  /**
   * Persist one episodic session narrative at conversation end.
   * Idempotent on sourceMessageId so re-running session_end updates rather than
   * duplicates the episodic record for the same conversation.
   *
   * @param input Agent, user, conversation ids, narrative content, and importance.
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
   * Persist a shared experiential insight stripped of PII.
   * Writes to __shared__ scope so all users benefit from agent-level learnings
   * when experiential memory is enabled for the agent.
   *
   * @param input Agent, conversation ids, insight content, and importance.
   * @returns True when a record was inserted or updated.
   *
   * Used by: SessionEndHandler.finalizeSession.
   */
  async writeExperientialInsight(input) {
    return this.writeScopedSession({
      agentId: input.agentId,
      userId: input.conversationId,
      conversationId: input.conversationId,
      content: stripPII(input.content),
      importance: input.importance,
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
      const updated = await this.memories.updateContent(
        existing.id,
        input.content,
        input.importance
      );
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
      importance: input.importance ?? 0.5,
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
      throw new Error("[memory] memory stores unavailable \u2014 cannot load memory_code");
    }
    const store = await this.memoryStores.ensureDefaultForAgent(agentId);
    if (!store.memoryCode?.trim()) {
      throw new Error(
        `[memory] no memory_code for agent "${agentId}" \u2014 run register:agents or RegisterAgent gRPC first`
      );
    }
    return store.memoryCode;
  }
}
function stripPII(text) {
  return text.replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, "[person]").replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g, "[email]").replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[phone]");
}
export {
  MemoryService
};
