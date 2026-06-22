/**
 * Platform bootstrap — wires Redis session store, Postgres/OpenSearch long-term
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
import { createOpenSearchClient, probeOpenSearch } from "./opensearch/client.js";
import { IndexManager } from "./opensearch/index-manager.js";
import { OpenSearchMemoriesStore } from "./opensearch/memories-store.js";
import { closePostgres, initPostgres, probePostgres } from "./postgres/client.js";
import { MemoryMetadataDb } from "./postgres/memory-metadata.js";
import { MemoryStoresDb } from "./postgres/memory-stores.js";
import { RecallLogDb } from "./postgres/recall-log.js";
import { PostgresOpenSearchMemories } from "./stores/MemoriesRepository.js";
import { createRedisClient, RedisStore } from "./stores/RedisStore.js";
async function createMemoryPlatform(publisher = null) {
  if (!config.openai.apiKey) {
    throw new Error("[memory] OPENAI_API_KEY required \u2014 set in .env");
  }
  const { store: sessionStore, redis } = await createSessionStore();
  const { memories, memoryStores, recallLog, postgresConnected, opensearchConnected } = await createLongTermStores();
  const memoryService = new MemoryService(memories, memoryStores);
  const promptGenerator = new PromptGenerator(memoryStores);
  console.log(
    `[memory] platform ready \u2014 postgres=${postgresConnected} opensearch=${opensearchConnected}`
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
    agentSetup: new AgentSetupService(memoryStores, promptGenerator),
    postgresConnected,
    opensearchConnected,
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
      `[memory] Redis required at ${config.redis.host}:${config.redis.port} \u2014 start docker compose. ${err}`
    );
  }
}
async function createLongTermStores() {
  const pgOk = await probePostgres().catch(() => false);
  const osOk = await probeOpenSearch();
  if (pgOk) {
    try {
      await initPostgres();
    } catch (err) {
      console.warn("[memory] Postgres init failed:", err);
    }
  }
  if (pgOk && osOk) {
    const client = createOpenSearchClient();
    const indexManager = new IndexManager(client);
    const osMemories = new OpenSearchMemoriesStore(client, indexManager);
    return {
      memories: new PostgresOpenSearchMemories(new MemoryMetadataDb(), osMemories),
      memoryStores: new MemoryStoresDb(),
      recallLog: new RecallLogDb(),
      postgresConnected: true,
      opensearchConnected: true
    };
  }
  const missing = [];
  if (!pgOk) missing.push("Postgres (DATABASE_URL)");
  if (!osOk) missing.push("OpenSearch (OPENSEARCH_URL)");
  throw new Error(
    `[memory] ${missing.join(" and ")} required \u2014 Postgres/Redis/RabbitMQ via docker compose; OpenSearch via OPENSEARCH_* in .env (AWS).`
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
