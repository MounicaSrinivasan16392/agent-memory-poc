/**
 * AppendTurn handler — persists turns to Redis and schedules summarize jobs.
 * (Internal name ObserveHandler; public gRPC RPC is AppendTurn.)
 */
import { config } from "../config.js";

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
    const session = await this.sessionStore.appendTurn(input.conversationId, input.turn, {
      lastPromptTokens: input.lastPromptTokens
    });
    const shouldSummarize = session.lastPromptTokens > 0
      && session.lastPromptTokens >= config.memory.summarizeTokenThreshold;
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
