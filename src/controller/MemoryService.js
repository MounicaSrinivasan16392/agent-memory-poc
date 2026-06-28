import { embedText } from "../embeddings.js";
import { config } from "../config.js";

/**
 * Long-term memory business logic.
 *
 * Coordinates PostgresStore (metadata rows) + QdrantStore (content + vectors).
 * Handlers and gRPC routes call this class — not the stores directly.
 *
 * Dual-write pattern (every long-term write):
 *   1. postgres — insert/upsert memory_metadata row (id = Qdrant point id)
 *   2. qdrant   — upsertPoint with content (+ embedding for episodic/experiential)
 */
class MemoryService {
  constructor(postgres, qdrant) {
    this.postgres = postgres;
    this.qdrant = qdrant;
  }
  postgres;
  qdrant;

  /**
   * Vector search over episodic/experiential memories.
   * Semantic profile is excluded — use getSemanticProfile() instead.
   */
  async searchMemories(agentId, userId, query, options) {
    const types = (options?.types ?? config.memory.typesEnabled).filter((t) => t !== "semantic");
    const topK = options?.topK ?? config.memory.retrievalK;
    const includeShared = options?.includeShared ?? types.includes("experiential");
    if (!query.trim() || types.length === 0 || topK <= 0) {
      return [];
    }
    const { embedding } = await embedText(query);
    const vectorHits = await this.qdrant.vectorSearch(
      agentId,
      userId,
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

  /** Load semantic profile: postgres metadata row + qdrant content by point id. */
  async getSemanticProfile(agentId, userId) {
    const meta = await this.postgres.getProfileMetadata(agentId, userId, "semantic");
    if (!meta) return null;
    const content = await this.qdrant.getContent(agentId, meta.id);
    if (!content?.trim()) return null;
    return toMemoryRecord(meta, content);
  }

  /** Replace user's semantic profile (session end only). Uses zero vector in Qdrant. */
  async setSemanticProfile(agentId, userId, content) {
    const trimmed = content.trim();
    if (!trimmed) return null;
    assertContentLength(trimmed, "semantic_profile");
    const meta = await this.postgres.upsertProfileMetadata({
      agentId,
      scope: userId,
      memoryTypeKey: "semantic"
    });
    await this.qdrant.upsertPoint({
      memoryId: meta.id,
      agentId,
      scope: userId,
      type: "semantic",
      content: trimmed
    });
    return toMemoryRecord(meta, trimmed);
  }

  /** Write one episodic session narrative (idempotent per conversationId). */
  async writeEpisodicSession(input) {
    return this.writeScopedSession({
      ...input,
      scope: input.userId,
      type: "episodic",
      sourceMessageId: `session_end:${input.conversationId}`
    });
  }

  /** Write shared experiential insight under __shared__ scope (optional, session end). */
  async writeExperientialInsight(input) {
    return this.writeScopedSession({
      agentId: input.agentId,
      scope: "__shared__",
      type: "experiential",
      content: input.content,
      sourceMessageId: `experiential:${input.conversationId}`
    });
  }

  /**
   * Insert or update episodic/experiential memory.
   * Idempotent on sourceMessageId — retries update the same postgres/qdrant point.
   */
  async writeScopedSession(input) {
    assertContentLength(input.content, input.type);
    const existing = await this.postgres.getMemoryBySourceMessageId(
      input.agentId,
      input.scope,
      input.sourceMessageId,
      input.type
    );
    let meta;
    if (existing) {
      meta = existing;
    } else {
      meta = await this.postgres.insertMemoryMetadata({
        agentId: input.agentId,
        scope: input.scope,
        memoryTypeKey: input.type,
        sourceMessageId: input.sourceMessageId
      });
      if (!meta) return false;
    }
    const { embedding } = await embedText(input.content);
    await this.qdrant.upsertPoint({
      memoryId: meta.id,
      agentId: meta.agentId,
      scope: meta.scope,
      type: meta.memoryTypeKey,
      content: input.content,
      embedding
    });
    return true;
  }

  /** Load agent memory_code from postgres (required for summarize + session_end LLM). */
  async getMemoryCode(agentId) {
    if (!this.postgres) {
      throw new Error("[memory] postgres unavailable - cannot load memory_code");
    }
    const store = await this.postgres.ensureAgentStore(agentId);
    if (!store.memoryCode?.trim()) {
      throw new Error(
        `[memory] no memory_code for agent "${agentId}" - run register:agents or RegisterAgent gRPC first`
      );
    }
    return store.memoryCode;
  }
}

/** Join postgres metadata row with content string into a single record shape. */
function toMemoryRecord(meta, content) {
  return {
    id: meta.id,
    agentId: meta.agentId,
    scope: meta.scope,
    type: meta.memoryTypeKey,
    content,
    isDeleted: meta.isDeleted
  };
}

/** Enforce MEMORY_MAX_CONTENT_CHARS from platform prompt / config. */
function assertContentLength(content, field) {
  const max = config.memory.maxContentChars;
  if (content.length <= max) return;
  throw new Error(
    `[memory] ${field} is ${content.length} chars — exceeds MEMORY_MAX_CONTENT_CHARS (${max})`
  );
}

export {
  MemoryService
};
