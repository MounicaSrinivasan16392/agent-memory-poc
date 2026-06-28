/**
 * Runtime configuration from environment variables (.env).
 *
 * Platform memory policy (typesEnabled, retrievalK, thresholds) lives here —
 * per-agent overrides would come from memory_stores.specification in a future version.
 */
import "dotenv/config";

const config = {
  grpc: {
    host: process.env.GRPC_HOST ?? "0.0.0.0",
    port: Number(process.env.GRPC_PORT ?? 50052)
  },
  postgres: {
    url: process.env.DATABASE_URL ?? "postgresql://memory:memory@127.0.0.1:5433/fluentmind_memory"
  },
  redis: {
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || void 0,
    db: Number(process.env.REDIS_DB ?? 0),
    sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 30)
  },
  qdrant: {
    url: process.env.QDRANT_URL ?? "http://127.0.0.1:6333",
    apiKey: process.env.QDRANT_API_KEY || void 0,
    /** Prepended to every per-agent collection, e.g. "fm_prod_" → fm_prod_{agentId} */
    collectionPrefix: process.env.QDRANT_COLLECTION_PREFIX ?? ""
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL ?? "amqp://guest:guest@127.0.0.1:5672",
    exchange: process.env.RABBITMQ_EXCHANGE ?? "memory",
    queue: process.env.RABBITMQ_QUEUE ?? "memory.jobs"
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini"
  },
  embeddings: {
    model: process.env.EMBEDDING_MODEL ?? "text-embedding-3-large",
    dimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? 3072)
  },
  memory: {
    typesEnabled: ["semantic", "episodic", "experiential"],
    retrievalK: Number(process.env.MEMORY_RETRIEVAL_K ?? 4),
    summarizeTokenThreshold: Number(process.env.MEMORY_SUMMARIZE_TOKEN_THRESHOLD ?? 1000),
    /** Max chars per long-term memory field at write time (semantic, episodic, experiential). */
    maxContentChars: Number(process.env.MEMORY_MAX_CONTENT_CHARS ?? 6000)
  }
};

export {
  config
};
