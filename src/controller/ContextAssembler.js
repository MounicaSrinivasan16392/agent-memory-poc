/**
 * Assemble Redis working memory + long-term hits into a context block for the LLM.
 * Always loads semantic profile (when present); episodic/experiential require a query.
 */
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
    if (input.incognito) {
      return emptyResult(start);
    }
    const cfg = input.memoryConfig ?? await this.memoryService.getMemoryConfig(input.agentId);
    const retrievalK = cfg.retrievalK ?? 6;
    const query = input.userQuery.trim();
    const typesEnabled = cfg.typesEnabled ?? ["semantic", "episodic"];
    const [session, memories] = await Promise.all([
      this.sessionStore.getSession(input.conversationId),
      this.memoryService.searchMemories(input.agentId, input.userId, query, {
        topK: retrievalK,
        types: typesEnabled,
        includeShared: cfg.experientialEnabled
      })
    ]);
    const recent = session.recent;
    const contextBlock = formatContextBlock({
      summary: session.summary,
      recent,
      memories
    });
    const latencyMs = Date.now() - start;
    if (this.recallLog && query) {
      this.recallLog.append({
        agentId: input.agentId,
        userId: input.userId,
        conversationId: input.conversationId,
        userQuery: query,
        memories,
        latencyMs
      }).catch((err) => console.warn("[memory] recall log write failed:", err));
    }
    return {
      summary: session.summary,
      recent,
      memories,
      contextBlock,
      latencyMs
    };
  }
}
function emptyResult(start) {
  return {
    summary: null,
    recent: [],
    memories: [],
    contextBlock: "",
    latencyMs: Date.now() - start
  };
}
export {
  ContextAssembler
};
