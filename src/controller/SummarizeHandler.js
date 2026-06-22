/**
 * Redis summarize worker logic — folds recent turns into session:summary via LLM.
 */
import { summarizeSessionWithLlm } from "../llm/summarize-session.js";
class SummarizeHandler {
  constructor(sessionStore) {
    this.sessionStore = sessionStore;
  }
  sessionStore;
  
  async summarize(input) {
    const session = await this.sessionStore.getSession(input.conversationId);
    const evicted = session.recent;
    if (evicted.length === 0) {
      return { updated: false, summary: session.summary };
    }
    const newSummary = await summarizeSessionWithLlm({
      memoryCode: input.memoryCode,
      previousSummary: session.summary,
      evictedTurns: evicted
    });
    await this.sessionStore.setSession({
      ...session,
      summary: newSummary,
      recent: [],
      lastPromptTokens: 0
    });
    return { updated: true, summary: newSummary };
  }
}
export {
  SummarizeHandler
};
