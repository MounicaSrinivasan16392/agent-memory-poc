/**
 * FluentMind memory-api gRPC client (plain JavaScript).
 *
 * Single integration surface for agent builders — call the memory service over gRPC;
 * do not import service internals from src/.
 *
 * Requires: npm run api (memory service on MEMORY_GRPC_HOST:PORT)
 */
import path from 'path';
import { fileURLToPath } from 'url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.join(__dirname, '../../proto/memory.proto');

function unary(client, method, request) {
  return new Promise((resolve, reject) => {
    client[method](request, (err, response) => {
      if (err) reject(err);
      else resolve(response);
    });
  });
}

function mapAssembleResponse(res) {
  return {
    summary: res.summary || null,
    recent: (res.recent ?? []).map((t) => ({
      id: t.id,
      user: t.user,
      assistant: t.assistant,
    })),
    memories: (res.memories ?? []).map((m) => ({
      memoryId: m.memory_id,
      type: m.type,
      content: m.content,
      score: m.score,
    })),
    contextBlock: res.context_block ?? '',
    latencyMs: res.latency_ms ?? 0,
  };
}

/**
 * Connect to the memory-api gRPC service.
 *
 * @param {{ host?: string, port?: string | number }} [options]
 * @returns {Promise<MemoryClient>}
 */
export async function createMemoryClient(options = {}) {
  const host = options.host ?? process.env.MEMORY_GRPC_HOST ?? '127.0.0.1';
  const port = String(options.port ?? process.env.MEMORY_GRPC_PORT ?? '50052');
  const address = `${host}:${port}`;

  const packageDef = protoLoader.loadSync(PROTO, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const proto = grpc.loadPackageDefinition(packageDef);
  const MemoryAPI = proto.memory.MemoryAPI;
  const client = new MemoryAPI(address, grpc.credentials.createInsecure());

  return new MemoryClient(client, address);
}

export class MemoryClient {
  /** @param {import('@grpc/grpc-js').Client} grpcClient */
  constructor(grpcClient, address) {
    this._client = grpcClient;
    this.address = address;
  }

  /**
   * Hot path — Redis session + long-term memories → context_block.
   */
  async assemble({
    agentId,
    userId,
    conversationId,
    userQuery = '',
  }) {
    const res = await unary(this._client, 'Assemble', {
      agent_id: agentId,
      user_id: userId,
      conversation_id: conversationId,
      user_query: userQuery,
    });
    return mapAssembleResponse(res);
  }

  /** Redis working-memory snapshot. */
  async getSession(conversationId) {
    const res = await unary(this._client, 'GetSession', {
      conversation_id: conversationId,
    });
    return {
      conversationId: res.conversation_id,
      summary: res.summary || null,
      recent: (res.recent ?? []).map((t) => ({
        id: t.id,
        user: t.user,
        assistant: t.assistant,
      })),
      turnCount: res.turn_count ?? 0,
      lastPromptTokens: res.last_prompt_tokens ?? 0,
    };
  }

  /**
   * Persist turn to Redis + queue memory.summarize when prompt token threshold exceeded.
   * Pass lastPromptTokens from result.usage.promptTokens after the chat LLM call.
   */
  async appendTurn({
    agentId,
    userId,
    conversationId,
    turn,
    lastPromptTokens,
  }) {
    const res = await unary(this._client, 'AppendTurn', {
      agent_id: agentId,
      user_id: userId,
      conversation_id: conversationId,
      turn: {
        id: turn.id,
        user: turn.user,
        assistant: turn.assistant,
      },
      last_prompt_tokens: lastPromptTokens ?? 0,
    });
    return {
      turnCount: res.turn_count ?? 0,
      lastPromptTokens: res.last_prompt_tokens ?? 0,
      summarizeScheduled: Boolean(res.summarize_scheduled),
    };
  }

  /** Queue memory.session_end consolidation. */
  async endSession({
    agentId,
    userId,
    conversationId,
    clearSession = true,
  }) {
    const res = await unary(this._client, 'EndSession', {
      agent_id: agentId,
      user_id: userId,
      conversation_id: conversationId,
      clear_session: clearSession,
    });
    return {
      scheduled: Boolean(res.scheduled),
      semanticUpdated: Boolean(res.semantic_updated),
      episodicWritten: Boolean(res.episodic_written),
      experientialWritten: Boolean(res.experiential_written),
    };
  }

  /** Vector search over episodic/experiential long-term memories. */
  async search({ agentId, userId, query, topK = 6 }) {
    const res = await unary(this._client, 'Search', {
      agent_id: agentId,
      user_id: userId,
      query,
      top_k: topK,
    });
    return (res.results ?? []).map((m) => ({
      memoryId: m.memory_id,
      type: m.type,
      content: m.content,
      score: m.score,
    }));
  }

  /** Long-term semantic profile — load once at chat start. */
  async getSemanticProfile({ agentId, userId }) {
    const res = await unary(this._client, 'GetSemanticProfile', {
      agent_id: agentId,
      user_id: userId,
    });
    const content = res.content?.trim() ?? '';
    if (!content) return null;
    return {
      memoryId: res.memory_id || null,
      content,
    };
  }

  close() {
    this._client.close();
  }
}
