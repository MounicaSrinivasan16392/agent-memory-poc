/**
 * Platform bootstrap — wires the three stores and controllers into one object.
 *
 * Stores:
 *   RedisStore   → working memory (session summary, recent turns)
 *   PostgresStore → metadata, agent policy, recall audit
 *   QdrantStore  → long-term content + vectors
 *
 * MemoryService coordinates Postgres + Qdrant for all long-term reads/writes.
 *
 * Entry points: grpc/server.js, worker/index.js, scripts/register-demo-agent.js
 */
import { config } from "./config.js";
import { AgentSetupService } from "./controller/AgentSetupService.js";
import { ContextAssembler } from "./controller/ContextAssembler.js";
import { MemoryService } from "./controller/MemoryService.js";
import { ObserveHandler } from "./controller/ObserveHandler.js";
import { PromptGenerator } from "./controller/PromptGenerator.js";
import { SessionEndHandler } from "./controller/SessionEndHandler.js";
import { SummarizeHandler } from "./controller/SummarizeHandler.js";
import { createQdrantClient, probeQdrant } from "./qdrant/client.js";
import { closePostgres, initPostgres, probePostgres } from "./postgres/client.js";
import { PostgresStore } from "./stores/PostgresStore.js";
import { QdrantStore } from "./stores/QdrantStore.js";
import { createRedisClient, RedisStore } from "./stores/RedisStore.js";

/** Build handlers + stores. Optional publisher queues async jobs to RabbitMQ. */
async function createMemoryPlatform(publisher = null) {
  if (!config.openai.apiKey) {
    throw new Error("[memory] OPENAI_API_KEY required - set in .env");
  }
  const { store: sessionStore, redis } = await createSessionStore();
  const { postgres, qdrant, postgresConnected, qdrantConnected } = await createLongTermStores();
  const memoryService = new MemoryService(postgres, qdrant);
  const promptGenerator = new PromptGenerator(postgres);
  console.log(
    `[memory] platform ready - postgres=${postgresConnected} qdrant=${qdrantConnected}`
  );
  return {
    sessionStore,
    postgres,
    qdrant,
    memoryService,
    assembler: new ContextAssembler(sessionStore, memoryService, postgres),
    observeHandler: new ObserveHandler(sessionStore, memoryService, publisher),
    summarizeHandler: new SummarizeHandler(sessionStore),
    sessionEndHandler: new SessionEndHandler(sessionStore, memoryService, publisher),
    promptGenerator,
    agentSetup: new AgentSetupService(postgres, promptGenerator, qdrant),
    postgresConnected,
    qdrantConnected,
    shutdown: () => shutdownConnections(redis, sessionStore)
  };
}

/** Close Redis connection and Postgres pool. */
async function shutdownConnections(redis, sessionStore) {
  if (redis) {
    await redis.quit().catch(() => {
    });
  } else if (sessionStore instanceof RedisStore) {
    await sessionStore.disconnect().catch(() => {
    });
  }
  await closePostgres();
}

/** Ping Redis and wrap the raw ioredis client in RedisStore. */
async function createSessionStore() {
  const redis = createRedisClient();
  try {
    await redis.ping();
    return { store: new RedisStore(redis), redis };
  } catch (err) {
    await redis.quit().catch(() => {
    });
    throw new Error(
      `[memory] Redis required at ${config.redis.host}:${config.redis.port} - start docker compose. ${err}`
    );
  }
}

/** Probe Postgres/Qdrant, apply schema, return store instances. */
async function createLongTermStores() {
  const pgOk = await probePostgres().catch(() => false);
  const qdrantOk = await probeQdrant();
  if (pgOk) {
    try {
      await initPostgres();
    } catch (err) {
      console.warn("[memory] Postgres init failed:", err);
    }
  }
  if (pgOk && qdrantOk) {
    const postgres = new PostgresStore();
    const qdrant = new QdrantStore(createQdrantClient());
    return {
      postgres,
      qdrant,
      postgresConnected: true,
      qdrantConnected: true
    };
  }
  const missing = [];
  if (!pgOk) missing.push("Postgres (DATABASE_URL)");
  if (!qdrantOk) missing.push("Qdrant (QDRANT_URL)");
  throw new Error(
    `[memory] ${missing.join(" and ")} required - start docker compose (postgres, redis, rabbitmq, qdrant).`
  );
}

export {
  AgentSetupService,
  ContextAssembler,
  MemoryService,
  ObserveHandler,
  PromptGenerator,
  SessionEndHandler,
  SummarizeHandler,
  createMemoryPlatform
};
