/**
 * Redis summarize worker logic.
 *
 * When prompt tokens exceed MEMORY_SUMMARIZE_TOKEN_THRESHOLD, recent turns are
 * evicted from Redis and folded into session:summary via the summarize LLM task.
 */
import { summarizeSessionWithLlm } from "../llm/summarize-session.js";

class SummarizeHandler {
  constructor(sessionStore) {
    this.sessionStore = sessionStore;
  }
  sessionStore;

  /**
   * Fold all current recent turns into summary; clear recent and reset token counter.
   * @returns {{ updated: boolean, summary: string | null }}
   */
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
