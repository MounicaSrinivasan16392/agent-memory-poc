/**
 * Redis working-memory store — session summary, recent turns, token counters.
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
