/**
 * Chat demo — FluentMind integration pattern (JS only on the agent side).
 *
 *   npm run api      → memory service (gRPC :50052)
 *   npm run worker   → RabbitMQ consumer
 *   npm run chat     → this file (AI SDK + clients/js → gRPC)
 *
 * Flow: User → LLM → AI SDK tools → gRPC memory-api → RabbitMQ → worker
 *
 * HTTP API serves chat-ui: /api/chat, /api/state (semantic profile panel), /api/session/end
 */
import 'dotenv/config';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { openai } from '@ai-sdk/openai';
import { generateText, stepCountIs } from 'ai';
import {
  createMemoryClient,
  createMemoryTools,
  inputTokensFromGenerateText,
} from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'chat-ui');
const PORT = Number(process.env.CHAT_PORT ?? 3000);
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

const SYSTEM_PROMPT = `You are a helpful sales assistant for CRM, renewals, and budget planning.

You have memory tools backed by memory-api (gRPC). On every user turn:
1. Call recall_memory with the user's message.
2. Answer using that context when relevant.

Use search_memories for extra long-term lookup.
Use end_session when the user explicitly ends the conversation.

Be concise and friendly.`;

/** @type {import('./memory-client.js').MemoryClient} */
let memory;

function newId() {
  return crypto.randomUUID();
}

/** Long-term semantic profile for agent + user (loaded at chat start, not via search). */
async function loadSemanticProfile(agentId, userId) {
  const profile = await memory.getSemanticProfile({ agentId, userId });
  return profile?.content ?? null;
}

async function waitForSemanticProfile(agentId, userId, before, { attempts = 15, intervalMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const profile = await loadSemanticProfile(agentId, userId);
    if (!profile) continue;
    if (!before || profile !== before) return profile;
  }
  return loadSemanticProfile(agentId, userId);
}

async function handleChat(body) {
  const { message, agentId, userId, conversationId } = body;
  if (!message?.trim()) throw new Error('message required');

  const toolCtx = {
    agentId,
    userId,
    conversationId,
  };
  const tools = createMemoryTools(memory, toolCtx);

  const semanticProfile = await loadSemanticProfile(agentId, userId);
  const system = semanticProfile
    ? `${SYSTEM_PROMPT}\n\n## User profile (long-term)\n${semanticProfile}`
    : SYSTEM_PROMPT;

  const result = await generateText({
    model: openai(OPENAI_MODEL),
    system,
    prompt: message,
    tools,
    stopWhen: stepCountIs(6),
    temperature: 0.7,
  });

  const turnId = newId();
  const appendResult = await memory.appendTurn({
    agentId,
    userId,
    conversationId,
    turn: { id: turnId, user: message, assistant: result.text || '' },
    lastPromptTokens: inputTokensFromGenerateText(result),
  });

  const toolCalls = result.steps.flatMap((s) => s.toolCalls);
  const recallStep = result.steps.find((s) =>
    s.toolResults.some((r) => r.toolName === 'recall_memory'),
  );
  const recallResult = recallStep?.toolResults.find((r) => r.toolName === 'recall_memory');

  const sessionAfter = await memory.getSession(conversationId);

  const assembled = recallResult?.output;

  return {
    reply: result.text || '(empty response)',
    turnId,
    integration: 'gRPC memory-api + AI SDK tools (clients/js)',
    aiSdk: {
      steps: result.steps.length,
      toolCalls: toolCalls.map((c) => ({ tool: c.toolName, input: c.input })),
      usage: result.usage,
    },
    assemble: assembled
      ? {
          latencyMs: assembled.latencyMs ?? 0,
          memories: assembled.memories ?? [],
          contextBlock: assembled.contextBlock ?? '',
          summary: assembled.summary ?? null,
          recentCount: assembled.recentTurns ?? 0,
        }
      : null,
    session: sessionAfter,
    jobs: {
      summarizeScheduled: appendResult.summarizeScheduled,
      lastPromptTokens: appendResult.lastPromptTokens,
    },
    semanticProfile,
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString());
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
  const url = req.url === '/' ? '/index.html' : (req.url?.split('?')[0] ?? '/');
  const filePath = path.join(UI_DIR, url);
  if (!filePath.startsWith(UI_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
  res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(filePath));
  return true;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY required in .env');
  }

  memory = await createMemoryClient();
  console.log(`[chat] connected to memory-api gRPC at ${memory.address}`);

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const route = req.url?.split('?')[0] ?? '/';

      if (req.method === 'GET' && route === '/api/health') {
        json(res, 200, {
          memoryApi: memory.address,
          rabbitmq: '(via memory-api AppendTurn)',
          llm: true,
          aiSdk: true,
          integration: 'clients/js → gRPC',
        });
        return;
      }

      if (req.method === 'GET' && route === '/api/state') {
        const q = new URL(req.url, 'http://localhost').searchParams;
        const agentId = q.get('agentId') ?? 'demo_sales_agent';
        const userId = q.get('userId') ?? 'user_alice';
        const conversationId = q.get('conversationId') ?? '';
        const [session, semanticProfile] = await Promise.all([
          conversationId ? memory.getSession(conversationId) : Promise.resolve(null),
          loadSemanticProfile(agentId, userId),
        ]);
        json(res, 200, { session, semanticProfile });
        return;
      }

      if (req.method === 'POST' && route === '/api/chat') {
        const body = await readJson(req);
        const result = await handleChat({
          message: String(body.message ?? ''),
          agentId: String(body.agentId ?? 'demo_sales_agent'),
          userId: String(body.userId ?? 'user_alice'),
          conversationId: String(body.conversationId ?? newId()),
        });
        json(res, 200, result);
        return;
      }

      if (req.method === 'POST' && route === '/api/session/end') {
        const body = await readJson(req);
        const agentId = String(body.agentId ?? 'demo_sales_agent');
        const userId = String(body.userId ?? 'user_alice');
        const beforeProfile = await loadSemanticProfile(agentId, userId);
        const result = await memory.endSession({
          agentId,
          userId,
          conversationId: String(body.conversationId),
          clearSession: body.clearSession !== false,
        });
        const semanticProfile = result.scheduled
          ? await waitForSemanticProfile(agentId, userId, beforeProfile)
          : await loadSemanticProfile(agentId, userId);
        json(res, 200, {
          scheduled: result.scheduled,
          semanticProfile,
          message: semanticProfile
            ? 'Session consolidated — semantic profile updated.'
            : 'memory.session_end job published — worker will consolidate (profile not ready yet)',
        });
        return;
      }

      if (req.method === 'GET' && route === '/api/search') {
        const q = new URL(req.url, 'http://localhost').searchParams;
        const hits = await memory.search({
          agentId: q.get('agentId') ?? 'demo_sales_agent',
          userId: q.get('userId') ?? 'user_alice',
          query: q.get('q') ?? '',
          topK: 6,
        });
        json(res, 200, { hits });
        return;
      }

      if (req.method === 'GET' && serveStatic(req, res)) return;

      json(res, 404, { error: 'not found' });
    } catch (err) {
      console.error('[chat]', err);
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[chat] demo UI → http://127.0.0.1:${PORT}`);
    console.log('[chat] User → LLM → clients/js tools → gRPC → RabbitMQ → worker');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
