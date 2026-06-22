/** Runtime configuration from environment variables (.env). */
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
  opensearch: {
    /** AWS OpenSearch domain — not run locally in docker-compose */
    node: process.env.OPENSEARCH_URL ?? "https://search-hub-data-engineering-yyusgsuukytwjsw3spb2r5fi54.aos.us-west-1.on.aws/",
    username: process.env.OPENSEARCH_USERNAME || void 0,
    password: process.env.OPENSEARCH_PASSWORD || void 0,
    /** Prepended to every per-agent index, e.g. "fm_prod_" → fm_prod_{agentId}-memories */
    indexPrefix: process.env.OPENSEARCH_INDEX_PREFIX ?? "",
    /** Suffix for long-term memory index. Full name: {prefix}{agentId}{suffix} */
    memoriesIndexSuffix: process.env.OPENSEARCH_MEMORIES_INDEX_SUFFIX ?? "-memories",
    numberOfShards: Number(process.env.OPENSEARCH_NUMBER_OF_SHARDS ?? 1),
    numberOfReplicas: Number(process.env.OPENSEARCH_NUMBER_OF_REPLICAS ?? 2)
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
  hybrid: {
    bm25Weight: Number(process.env.HYBRID_BM25_WEIGHT ?? 0.5),
    vectorWeight: Number(process.env.HYBRID_VECTOR_WEIGHT ?? 0.3),
    importanceWeight: Number(process.env.HYBRID_IMPORTANCE_WEIGHT ?? 0.2)
  }
};
export {
  config
};
