/**
 * Shared memory LLM caller.
 *
 * Loads platform.memory.system.md (global rules) and combines it with the agent's
 * memory_code (extraction policy). Used by summarize and session_end tasks.
 *
 * All memory LLM calls return JSON — see platform.memory.system.md for schemas.
 */
import OpenAI from "openai";
import { config } from "../config.js";
import { loadPlatformPrompt } from "./load-prompt.js";

/**
 * @param {"summarize" | "session_end"} task
 * @param {string} memoryCode — agent extraction policy from memory_stores
 * @param {string} inputBlock — task-specific context (session turns, summary, etc.)
 * @returns {Promise<string>} raw JSON string from the model
 */
async function callMemoryLlm(task, memoryCode, inputBlock) {
  const client = new OpenAI({ apiKey: config.openai.apiKey });
  const platform = loadPlatformPrompt("platform.memory.system.md").replaceAll(
    "{{MAX_CONTENT_CHARS}}",
    String(config.memory.maxContentChars)
  );
  const response = await client.chat.completions.create({
    model: config.openai.model,
    temperature: task === "summarize" ? 0.3 : 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: platform },
      {
        role: "user",
        content: `TASK: ${task}

AGENT_MEMORY_CODE:
${memoryCode}

INPUT:
${inputBlock}`
      }
    ]
  });
  return response.choices[0]?.message?.content ?? "{}";
}

export {
  callMemoryLlm
};
