/**
 * Redis working-memory store.
 *
 * Holds per-conversation state until session end (or TTL expiry):
 *   summary           — rolling LLM-compressed history
 *   recent            — raw turns not yet folded into summary
 *   turn_count        — total turns this session
 *   last_prompt_tokens — last chat LLM prompt size (triggers summarize job)
 *
 * Keys: session:{conversationId}:{summary|recent|turn_count|last_prompt_tokens}
 */
import { Redis } from "ioredis";
import { config } from "../config.js";

const keys = (conversationId) => ({
  summary: `session:${conversationId}:summary`,
  recent: `session:${conversationId}:recent`,
  turnCount: `session:${conversationId}:turn_count`,
  lastPromptTokens: `session:${conversationId}:last_prompt_tokens`
});

/** Create ioredis client from config — caller must ping() before use. */
function createRedisClient() {
  return new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    db: config.redis.db,
    maxRetriesPerRequest: 3,
    lazyConnect: false
  });
}

class RedisStore {
  constructor(redis) {
    this.redis = redis;
  }
  redis;

  /** Read full session snapshot for a conversation. */
  async getSession(conversationId) {
    const k = keys(conversationId);
    const [summary, recentRaw, turnCountRaw, lastPromptTokensRaw] = await this.redis.mget(
      k.summary,
      k.recent,
      k.turnCount,
      k.lastPromptTokens
    );
    let recent = [];
    if (recentRaw) {
      try {
        recent = JSON.parse(recentRaw);
      } catch {
        recent = [];
      }
    }
    return {
      conversationId,
      summary: summary || null,
      recent,
      turnCount: turnCountRaw ? Number(turnCountRaw) : 0,
      lastPromptTokens: lastPromptTokensRaw ? Number(lastPromptTokensRaw) : 0
    };
  }

  /** Replace session fields (used after summarize folds recent → summary). */
  async setSession(state) {
    const k = keys(state.conversationId);
    const ttl = config.redis.sessionTtlSeconds;
    const pipeline = this.redis.pipeline();
    if (state.summary) {
      pipeline.setex(k.summary, ttl, state.summary);
    } else {
      pipeline.del(k.summary);
    }
    pipeline.setex(k.recent, ttl, JSON.stringify(state.recent));
    pipeline.setex(k.turnCount, ttl, String(state.turnCount));
    pipeline.setex(k.lastPromptTokens, ttl, String(state.lastPromptTokens ?? 0));
    await pipeline.exec();
  }

  /** Append one turn; optionally update lastPromptTokens from chat LLM usage. */
  async appendTurn(conversationId, turn, opts) {
    const session = await this.getSession(conversationId);
    const recent = [...session.recent, turn];
    const turnCount = session.turnCount + 1;
    const lastPromptTokens = opts?.lastPromptTokens !== void 0 ? opts.lastPromptTokens : session.lastPromptTokens;
    const ttl = config.redis.sessionTtlSeconds;
    const next = {
      conversationId,
      summary: session.summary,
      recent,
      turnCount,
      lastPromptTokens
    };
    const k = keys(conversationId);
    const pipeline = this.redis.pipeline();
    if (session.summary) {
      pipeline.setex(k.summary, ttl, session.summary);
    }
    pipeline.setex(k.recent, ttl, JSON.stringify(recent));
    pipeline.setex(k.turnCount, ttl, String(turnCount));
    pipeline.setex(k.lastPromptTokens, ttl, String(lastPromptTokens));
    await pipeline.exec();
    return next;
  }

  async incrementTurnCount(conversationId) {
    const k = keys(conversationId);
    const ttl = config.redis.sessionTtlSeconds;
    const count = await this.redis.incr(k.turnCount);
    await this.redis.expire(k.turnCount, ttl);
    return count;
  }

  /** Delete all session keys — called after successful session_end consolidation. */
  async clearSession(conversationId) {
    const k = keys(conversationId);
    await this.redis.del(k.summary, k.recent, k.turnCount, k.lastPromptTokens);
  }

  async disconnect() {
    await this.redis.quit();
  }

  async health() {
    const start = Date.now();
    try {
      const pong = await this.redis.ping();
      return { status: pong === "PONG" ? "healthy" : "unhealthy", latencyMs: Date.now() - start };
    } catch (err) {
      return { status: "unhealthy", latencyMs: Date.now() - start, detail: String(err) };
    }
  }
}

export {
  RedisStore,
  createRedisClient
};
