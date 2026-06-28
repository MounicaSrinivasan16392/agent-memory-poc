/**
 * gRPC MemoryAPI server — exposes Assemble, AppendTurn, Search, EndSession, etc.
 * Publishes async jobs (summarize, session_end) to RabbitMQ when configured.
 */
import path from "path";
import { fileURLToPath } from "url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import "dotenv/config";
import { config } from "../config.js";
import { createMemoryPlatform } from "../index.js";
import { createJobPublisher } from "../queue/rabbitmq.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.join(__dirname, "../../proto/memory.proto");

async function main() {
  const publisher = await createJobPublisher();
  const platform = await createMemoryPlatform(publisher);
  const packageDef = protoLoader.loadSync(PROTO, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });
  
  const proto = grpc.loadPackageDefinition(packageDef);
  const memoryPkg = proto["memory"];
  const serviceDef = memoryPkg["MemoryAPI"].service;
  const server = new grpc.Server();
  server.addService(serviceDef, {
    /** Hot path: Redis session + semantic profile + vector recall → context_block. */
    Assemble: (async (call, cb) => {
      try {
        const req = call.request;
        const result = await platform.assembler.assemble({
          agentId: String(req["agent_id"]),
          userId: String(req["user_id"]),
          conversationId: String(req["conversation_id"]),
          userQuery: String(req["user_query"] ?? "")
        });
        cb(null, {
          summary: result.summary ?? "",
          recent: result.recent.map((t) => ({ id: t.id, user: t.user, assistant: t.assistant })),
          memories: result.memories.map((m) => ({
            memory_id: m.memoryId,
            type: m.type,
            content: m.content,
            score: m.score
          })),
          context_block: result.contextBlock,
          latency_ms: result.latencyMs
        });
      } catch (err) {
        cb(err, null);
      }
    }),
    /** Redis session snapshot — summary, recent turns, token counters. */
    GetSession: (async (call, cb) => {
      try {
        const conversationId = String(call.request["conversation_id"]);
        const session = await platform.sessionStore.getSession(conversationId);
        cb(null, {
          conversation_id: session.conversationId,
          summary: session.summary ?? "",
          recent: session.recent.map((t) => ({ id: t.id, user: t.user, assistant: t.assistant })),
          turn_count: session.turnCount,
          last_prompt_tokens: session.lastPromptTokens
        });
      } catch (err) {
        cb(err, null);
      }
    }),
    /** Persist turn to Redis; queue memory.summarize when over token threshold. */
    AppendTurn: (async (call, cb) => {
      try {
        const req = call.request;
        const turnRaw = req["turn"];
        const lastPromptTokens = Number(req["last_prompt_tokens"] ?? 0);
        const result = await platform.observeHandler.appendTurnSync({
          agentId: String(req["agent_id"]),
          userId: String(req["user_id"]),
          conversationId: String(req["conversation_id"]),
          turn: {
            id: String(turnRaw["id"]),
            user: String(turnRaw["user"]),
            assistant: String(turnRaw["assistant"])
          },
          lastPromptTokens
        });
        cb(null, {
          turn_count: result.turnCount,
          summarize_scheduled: result.summarizeScheduled,
          last_prompt_tokens: result.lastPromptTokens
        });
      } catch (err) {
        cb(err, null);
      }
    }),
    /** Vector search over episodic/experiential memories (semantic profile excluded). */
    Search: (async (call, cb) => {
      try {
        const req = call.request;
        const results = await platform.memoryService.searchMemories(
          String(req["agent_id"]),
          String(req["user_id"]),
          String(req["query"]),
          { topK: Number(req["top_k"] ?? config.memory.retrievalK) }
        );
        cb(null, {
          results: results.map((m) => ({
            memory_id: m.memoryId,
            type: m.type,
            content: m.content,
            score: m.score
          }))
        });
      } catch (err) {
        cb(err, null);
      }
    }),
    /** Load the user's semantic profile — call at chat start, not via Search. */
    GetSemanticProfile: (async (call, cb) => {
      try {
        const req = call.request;
        const profile = await platform.memoryService.getSemanticProfile(
          String(req["agent_id"]),
          String(req["user_id"])
        );
        cb(null, {
          memory_id: profile?.id ?? "",
          content: profile?.content ?? ""
        });
      } catch (err) {
        cb(err, null);
      }
    }),
    /** Queue or run session_end — semantic reconcile + episodic/experiential writes. */
    EndSession: (async (call, cb) => {
      try {
        const req = call.request;
        const payload = {
          agentId: String(req["agent_id"]),
          userId: String(req["user_id"]),
          conversationId: String(req["conversation_id"]),
          clearSession: req["clear_session"] !== false
        };
        if (publisher) {
          const { scheduled } = await platform.sessionEndHandler.scheduleSessionEnd(payload);
          cb(null, { scheduled, semantic_updated: false, episodic_written: false });
          return;
        }
        const result = await platform.sessionEndHandler.finalizeSession(payload);
        cb(null, {
          scheduled: false,
          semantic_updated: result.semanticUpdated,
          episodic_written: result.episodicWritten
        });
      } catch (err) {
        cb(err, null);
      }
    }),
    /** One-time agent setup — postgres store, Qdrant collection, memory_code generation. */
    RegisterAgent: (async (call, cb) => {
      try {
        const req = call.request;
        const result = await platform.agentSetup.registerAgent({
          agentId: String(req["agent_id"]),
          systemPrompt: String(req["system_prompt"] ?? "")
        });
        cb(null, {
          memory_code_generated: result.memoryCodeGenerated
        });
      } catch (err) {
        cb(err, null);
      }
    })
  });
  const addr = `${config.grpc.host}:${config.grpc.port}`;
  server.bindAsync(addr, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) throw err;
    console.log(`[memory-api] gRPC listening on ${addr} (port ${port})`);
  });
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
