/** Combined long-term memory repository — Postgres metadata + Qdrant content. */
class PostgresQdrantMemories {
  constructor(meta, vectors) {
    this.meta = meta;
    this.vectors = vectors;
  }
  meta;
  vectors;

  async ensureAgentCollection(agentId) {
    return this.vectors.ensureCollection(agentId);
  }

  async getSemanticProfile(agentId, scope) {
    return this.getProfileRecord(agentId, scope, "semantic");
  }

  async setSemanticProfile(agentId, scope, content) {
    const trimmed = content.trim();
    if (!trimmed) return null;
    return this.writeProfile(agentId, scope, "semantic", trimmed);
  }

  async insert(input) {
    const meta = await this.meta.insert({
      agentId: input.agentId,
      memoryTypeKey: input.type,
      scope: input.scope,
      sourceMessageId: input.sourceMessageId
    });
    if (!meta) return null;
    await this.vectors.index({
      memoryId: meta.id,
      agentId: input.agentId,
      scope: input.scope,
      type: input.type,
      content: input.content
    });
    return toMemoryRecord(meta, input.content);
  }

  async updateContent(memoryId, content) {
    const meta = await this.meta.getById(memoryId);
    if (!meta) return null;
    await this.vectors.index({
      memoryId: meta.id,
      agentId: meta.agentId,
      scope: meta.scope,
      type: meta.memoryTypeKey,
      content
    });
    return toMemoryRecord(meta, content);
  }

  async getBySourceMessageId(agentId, scope, sourceMessageId, type) {
    const meta = await this.meta.getBySourceMessageId(agentId, scope, sourceMessageId, type);
    if (!meta) return null;
    const content = await this.vectors.getContent(agentId, meta.id);
    if (!content) return null;
    return toMemoryRecord(meta, content);
  }

  vectorSearch(agentId, userId, query, topK, embedding, types, includeShared) {
    return this.vectors.vectorSearch(agentId, userId, query, topK, embedding, types, includeShared);
  }

  async indexToSearch(record, embedding) {
    await this.vectors.index({
      memoryId: record.id,
      agentId: record.agentId,
      scope: record.scope,
      type: record.type,
      content: record.content,
      embedding: embedding ?? void 0
    });
  }

  async getProfileRecord(agentId, scope, typeKey) {
    const meta = await this.meta.getProfile(agentId, scope, typeKey);
    if (!meta) return null;
    const content = await this.vectors.getContent(agentId, meta.id);
    if (!content?.trim()) return null;
    return toMemoryRecord(meta, content);
  }

  async writeProfile(agentId, scope, typeKey, content) {
    const meta = await this.meta.upsertProfile({
      agentId,
      memoryTypeKey: typeKey,
      scope
    });
    await this.vectors.index({
      memoryId: meta.id,
      agentId,
      scope,
      type: typeKey,
      content
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
    isDeleted: meta.isDeleted
  };
}
export {
  PostgresQdrantMemories
};
