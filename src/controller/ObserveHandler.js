/**
 * AppendTurn handler — persists turns to Redis and schedules summarize jobs.
 * (Internal name ObserveHandler; public gRPC RPC is AppendTurn.)
 */
import { SUMMARIZE_TOKEN_THRESHOLD } from "../constants.js";
function resolveSummarizeConfig(cfg) {
  return {
    tokenThreshold: cfg?.summarizeTokenThreshold ?? SUMMARIZE_TOKEN_THRESHOLD
  };
}
class ObserveHandler {
  constructor(sessionStore, memoryService, publisher) {
    this.sessionStore = sessionStore;
    this.memoryService = memoryService;
    this.publisher = publisher;
  }
  sessionStore;
  memoryService;
  publisher;
  /**
   * Append turn to Redis; schedule summarize when lastPromptTokens >= threshold.
   * Semantic profile updates happen at session end only (memory.session_end).
   */
  async appendTurnSync(input) {
    if (input.incognito) {
      return { turnCount: 0, lastPromptTokens: 0, summarizeScheduled: false };
    }
    const session = await this.sessionStore.appendTurn(input.conversationId, input.turn, {
      lastPromptTokens: input.lastPromptTokens
    });
    const summarizeCfg = resolveSummarizeConfig(input.memoryConfig);
    const shouldSummarize = session.lastPromptTokens > 0
      && session.lastPromptTokens >= summarizeCfg.tokenThreshold;
    let summarizeScheduled = false;
    if (shouldSummarize && this.publisher) {
      await this.publisher.publish("memory.summarize", {
        agentId: input.agentId,
        conversationId: input.conversationId
      });
      summarizeScheduled = true;
    }
    return {
      turnCount: session.turnCount,
      lastPromptTokens: session.lastPromptTokens,
      summarizeScheduled
    };
  }
}
export {
  ObserveHandler
};
