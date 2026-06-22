/**
 * Session-end consolidation — LLM reconcile + long-term writes + optional Redis clear.
 */
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
   * Chat and gRPC servers call this at conversation end so heavy LLM work stays
   * off the request path when RabbitMQ is available.
   *
   * @param input Session-end payload with agent, user, conversation, and options.
   * @returns Whether a background job was scheduled (false when run inline).
   *
   * Used by: clients/js end_session (via gRPC EndSession), grpc/server EndSession.
   */
  async scheduleSessionEnd(input) {
    if (!this.publisher) {
      await this.finalizeSession(input);
      return { scheduled: false };
    }
    await this.publisher.publish("memory.session_end", input);
    return { scheduled: true };
  }
  /**
   * Consolidate a full session into long-term memory and optionally clear Redis.
   * Runs LLM consolidation against memory_code, writes semantic profile, episodic
   * narrative, and experiential insight per agent memory config, then clears session.
   *
   * @param payload Session-end job payload with ids and optional memory config.
   * @returns Flags indicating which memory types were written this run.
   *
   * Used by: worker/jobs/session_end, scheduleSessionEnd (inline), grpc/server, examples.
   */
  async finalizeSession(payload) {
    const memoryConfig = payload.memoryConfig ?? await this.memoryService.getMemoryConfig(payload.agentId);
    const session = await this.sessionStore.getSession(payload.conversationId);
    if (session.turnCount === 0) {
      return { semanticUpdated: false, episodicWritten: false, experientialWritten: false };
    }
    const [memoryCode, existingProfile] = await Promise.all([
      this.memoryService.getMemoryCode(payload.agentId),
      this.memoryService.getSemanticProfile(payload.agentId, payload.userId)
    ]);
    const consolidation = await consolidateSessionMemories({
      memoryCode,
      existingSemanticProfile: existingProfile?.content ?? null,
      session,
      experientialEnabled: memoryConfig.experientialEnabled
    });
    let semanticUpdated = false;
    if (memoryConfig.typesEnabled?.includes("semantic") !== false && consolidation.semanticProfile.trim()) {
      await this.memoryService.setSemanticProfile(
        payload.agentId,
        payload.userId,
        consolidation.semanticProfile
      );
      semanticUpdated = true;
    }
    let episodicWritten = false;
    if (memoryConfig.typesEnabled?.includes("episodic") && consolidation.episodic?.content.trim()) {
      episodicWritten = await this.memoryService.writeEpisodicSession({
        agentId: payload.agentId,
        userId: payload.userId,
        conversationId: payload.conversationId,
        content: consolidation.episodic.content,
        importance: consolidation.episodic.importance
      });
    }
    let experientialWritten = false;
    if (memoryConfig.experientialEnabled && consolidation.experiential?.content.trim()) {
      experientialWritten = await this.memoryService.writeExperientialInsight({
        agentId: payload.agentId,
        conversationId: payload.conversationId,
        content: consolidation.experiential.content,
        importance: consolidation.experiential.importance
      });
    }
    if (payload.clearSession !== false) {
      await this.sessionStore.clearSession(payload.conversationId);
    }
    return { semanticUpdated, episodicWritten, experientialWritten };
  }
}
export {
  SessionEndHandler
};
