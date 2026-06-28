/**
 * Platform bootstrap — wires Redis session store, Postgres/Qdrant long-term
 * memory, controllers, and optional RabbitMQ publisher.
 * Used by: grpc/server.js, worker/index.js, scripts/register-demo-agent.js
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
import { CollectionManager } from "./qdrant/collection-manager.js";
import { QdrantMemoriesStore } from "./qdrant/memories-store.js";
import { closePostgres, initPostgres, probePostgres } from "./postgres/client.js";
import { MemoryMetadataDb } from "./postgres/memory-metadata.js";
import { MemoryStoresDb } from "./postgres/memory-stores.js";
import { RecallLogDb } from "./postgres/recall-log.js";
import { PostgresQdrantMemories } from "./stores/MemoriesRepository.js";
import { createRedisClient, RedisStore } from "./stores/RedisStore.js";

async function createMemoryPlatform(publisher = null) {
  if (!config.openai.apiKey) {
    throw new Error("[memory] OPENAI_API_KEY required - set in .env");
  }
  const { store: sessionStore, redis } = await createSessionStore();
  const { memories, memoryStores, recallLog, postgresConnected, qdrantConnected } = await createLongTermStores();
  const memoryService = new MemoryService(memories, memoryStores);
  const promptGenerator = new PromptGenerator(memoryStores);
  console.log(
    `[memory] platform ready - postgres=${postgresConnected} qdrant=${qdrantConnected}`
  );
  return {
    sessionStore,
    memories,
    recallLog,
    memoryService,
    assembler: new ContextAssembler(sessionStore, memoryService, recallLog),
    observeHandler: new ObserveHandler(sessionStore, memoryService, publisher),
    summarizeHandler: new SummarizeHandler(sessionStore),
    sessionEndHandler: new SessionEndHandler(sessionStore, memoryService, publisher),
    promptGenerator,
    agentSetup: new AgentSetupService(memoryStores, promptGenerator, memories),
    postgresConnected,
    qdrantConnected,
    shutdown: () => shutdownConnections(redis, sessionStore)
  };
}
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
    const client = createQdrantClient();
    const collectionManager = new CollectionManager(client);
    const vectorMemories = new QdrantMemoriesStore(client, collectionManager);
    return {
      memories: new PostgresQdrantMemories(new MemoryMetadataDb(), vectorMemories),
      memoryStores: new MemoryStoresDb(),
      recallLog: new RecallLogDb(),
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
