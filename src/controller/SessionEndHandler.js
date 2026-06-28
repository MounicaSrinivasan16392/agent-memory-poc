/**
 * Session-end consolidation — LLM reconcile + long-term writes + optional Redis clear.
 */
import { config } from "../config.js";
import { consolidateSessionMemories } from "../llm/consolidate-session.js";

class SessionEndHandler {
  /**
   * @param sessionStore Redis working memory store.
   * @param memoryService Long-term memory writes and policy lookup.
   * @param publisher RabbitMQ publisher; null runs finalizeSession inline.
   */
  constructor(sessionStore, memoryService, publisher) {
    this.sessionStore = sessionStore;
    this.memoryService = memoryService;
    this.publisher = publisher;
  }
  sessionStore;
  memoryService;
  publisher;
  /**
   * Enqueue session_end consolidation or run inline when no publisher is wired.
   * Snapshots Redis session at schedule time so async workers are not affected by
   * later summarize/clear races on the same conversation.
   */
  async scheduleSessionEnd(input) {
    const session = await this.sessionStore.getSession(input.conversationId);
    const payload = { ...input, sessionSnapshot: session };
    if (!this.publisher) {
      await this.finalizeSession(payload);
      return { scheduled: false };
    }
    await this.publisher.publish("memory.session_end", payload);
    return { scheduled: true };
  }
  /**
   * Consolidate a full session into long-term memory and optionally clear Redis.
   */
  async finalizeSession(payload) {
    const { typesEnabled } = config.memory;
    const session = payload.sessionSnapshot
      ?? await this.sessionStore.getSession(payload.conversationId);
    const hasTurns = session.recent.length > 0;
    const hasSummary = Boolean(session.summary?.trim());
    if (session.turnCount === 0) {
      return {
        semanticUpdated: false,
        episodicWritten: false,
        experientialWritten: false,
        skippedReason: "no turns in Redis session (chat first, then end session)"
      };
    }
    if (!hasTurns && !hasSummary) {
      return {
        semanticUpdated: false,
        episodicWritten: false,
        experientialWritten: false,
        skippedReason: `turn count ${session.turnCount} but no summary or recent turns to consolidate`
      };
    }
    const [memoryCode, existingProfile] = await Promise.all([
      this.memoryService.getMemoryCode(payload.agentId),
      this.memoryService.getSemanticProfile(payload.agentId, payload.userId)
    ]);
    const consolidation = await consolidateSessionMemories({
      memoryCode,
      existingSemanticProfile: existingProfile?.content ?? null,
      session
    });
    let semanticUpdated = false;
    if (typesEnabled.includes("semantic") && consolidation.semanticProfile.trim()) {
      await this.memoryService.setSemanticProfile(
        payload.agentId,
        payload.userId,
        consolidation.semanticProfile
      );
      semanticUpdated = true;
    }
    let episodicWritten = false;
    if (typesEnabled.includes("episodic") && consolidation.episodic) {
      episodicWritten = await this.memoryService.writeEpisodicSession({
        agentId: payload.agentId,
        userId: payload.userId,
        conversationId: payload.conversationId,
        content: consolidation.episodic
      });
    }
    let experientialWritten = false;
    if (typesEnabled.includes("experiential") && consolidation.experiential) {
      experientialWritten = await this.memoryService.writeExperientialInsight({
        agentId: payload.agentId,
        conversationId: payload.conversationId,
        content: consolidation.experiential
      });
    }
    const wrote =
      semanticUpdated || episodicWritten || experientialWritten;
    if (wrote && payload.clearSession !== false) {
      await this.sessionStore.clearSession(payload.conversationId);
    }
    return {
      semanticUpdated,
      episodicWritten,
      experientialWritten,
      skippedReason: wrote
        ? void 0
        : "LLM returned no semantic/episodic/experiential content to persist"
    };
  }
}
export {
  SessionEndHandler
};
