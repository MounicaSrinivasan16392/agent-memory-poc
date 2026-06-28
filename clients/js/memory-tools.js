/**
 * Vercel AI SDK memory tools — thin wrappers over memory-api gRPC.
 *
 * Agent builder pattern:
 *   User → chat LLM → these tools → gRPC memory-api → RabbitMQ → worker
 *
 * @param {import('./memory-client.js').MemoryClient} memoryClient
 * @param {{ agentId: string, userId: string, conversationId: string, lastPromptTokens?: number }} ctx
 */
import { tool } from "ai";
import { z } from "zod";
import crypto from "crypto";

function newTurnId() {
  return crypto.randomUUID();
}

export function createMemoryTools(memoryClient, ctx) {
  const recall_memory = tool({
    description:
      'Load session + long-term context for the user query via memory-api Assemble. Call before answering.',
    inputSchema: z.object({
      query: z.string().describe('User message or topic to recall context for'),
    }),
    execute: async ({ query }) => {
      const assembled = await memoryClient.assemble({
        agentId: ctx.agentId,
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        userQuery: query,
      });
      return {
        latencyMs: assembled.latencyMs,
        summary: assembled.summary,
        recentTurns: assembled.recent.length,
        memories: assembled.memories.map((m) => ({
          type: m.type,
          score: m.score,
          content: m.content.slice(0, 500),
        })),
        contextBlock: assembled.contextBlock,
      };
    },
  });

  const search_memories = tool({
    description: 'Vector search over episodic and experiential long-term memories (semantic excluded).',
    inputSchema: z.object({
      query: z.string(),
      topK: z.number().int().min(1).max(20).optional(),
    }),
    execute: async ({ query, topK }) => {
      const hits = await memoryClient.search({
        agentId: ctx.agentId,
        userId: ctx.userId,
        query,
        topK: topK ?? 6,
      });
      return { hits };
    },
  });

  const append_turn = tool({
    description:
      'Persist user/assistant exchange via memory-api AppendTurn (Redis). Call after your final reply.',
    inputSchema: z.object({
      userMessage: z.string(),
      assistantReply: z.string(),
    }),
    execute: async ({ userMessage, assistantReply }) => {
      const turnId = newTurnId();
      const append = await memoryClient.appendTurn({
        agentId: ctx.agentId,
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        turn: { id: turnId, user: userMessage, assistant: assistantReply },
        lastPromptTokens: ctx.lastPromptTokens,
      });
      return {
        turnId,
        turnCount: append.turnCount,
        lastPromptTokens: append.lastPromptTokens,
        summarizeScheduled: append.summarizeScheduled,
      };
    },
  });

  const end_session = tool({
    description: 'End session — queues memory.session_end via memory-api.',
    inputSchema: z.object({
      clearSession: z.boolean().optional(),
    }),
    execute: async ({ clearSession }) => {
      const result = await memoryClient.endSession({
        agentId: ctx.agentId,
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        clearSession: clearSession !== false,
      });
      return {
        scheduled: result.scheduled,
        message: 'memory.session_end job published — worker will consolidate',
      };
    },
  });

  return {
    recall_memory,
    search_memories,
    append_turn,
    end_session,
  };
}
