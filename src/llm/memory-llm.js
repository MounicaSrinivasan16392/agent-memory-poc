/**
 * Shared memory LLM caller — wraps platform.memory.system.md + agent memory_code.
 * Tasks: summarize, session_end
 */
import OpenAI from "openai";
import { config } from "../config.js";
import { loadPlatformPrompt } from "./load-prompt.js";


async function callMemoryLlm(task, memoryCode, inputBlock) {
  const client = new OpenAI({ apiKey: config.openai.apiKey });
  const platform = loadPlatformPrompt("platform.memory.system.md");
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
