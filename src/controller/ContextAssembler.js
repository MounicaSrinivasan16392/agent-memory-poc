/**
 * Assemble Redis working memory + long-term context for the LLM.
 * Semantic profile is loaded separately; episodic/experiential come from vector search.
 */
import { config } from "../config.js";
import { formatContextBlock } from "../utils/context-block.js";

class ContextAssembler {
  constructor(sessionStore, memoryService, recallLog = null) {
    this.sessionStore = sessionStore;
    this.memoryService = memoryService;
    this.recallLog = recallLog;
  }
  sessionStore;
  memoryService;
  recallLog;
  async assemble(input) {
    const start = Date.now();
    const { typesEnabled, retrievalK } = config.memory;
    const query = input.userQuery.trim();
    const [session, semanticProfile, recalledMemories] = await Promise.all([
      this.sessionStore.getSession(input.conversationId),
      this.memoryService.getSemanticProfile(input.agentId, input.userId),
      query
        ? this.memoryService.searchMemories(input.agentId, input.userId, query, {
            topK: retrievalK,
            types: typesEnabled,
            includeShared: typesEnabled.includes("experiential")
          })
        : Promise.resolve([])
    ]);

    const recent = session.recent;
    const semanticContent = semanticProfile?.content?.trim() ?? "";
    const contextBlock = formatContextBlock({
      summary: session.summary,
      recent,
      semanticProfile: semanticContent,
      memories: recalledMemories
    });

    const latencyMs = Date.now() - start;
    if (this.recallLog && query) {
      this.recallLog.append({
        agentId: input.agentId,
        userId: input.userId,
        conversationId: input.conversationId,
        userQuery: query,
        memories: recalledMemories,
        semanticProfile: semanticContent,
        latencyMs
      }).catch((err) => console.warn("[memory] recall log write failed:", err));
    }
    return {
      summary: session.summary,
      recent,
      semanticProfile: semanticContent,
      memories: recalledMemories,
      contextBlock,
      latencyMs
    };
  }
}
export {
  ContextAssembler
};
