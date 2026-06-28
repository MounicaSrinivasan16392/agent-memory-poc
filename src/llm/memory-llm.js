/**
 * Shared memory LLM caller — wraps platform.memory.system.md + agent memory_code.
 * Tasks: summarize, session_end
 */

/** this function is used to call the memory LLM */
/**
 * @param {string} task - the task to perform
 * @param {string} memoryCode - the memory code to use
 * @param {string} inputBlock - the input block to use - inputBlock is the input to the LLM ie input to the task is the chat messages.
 * @returns {Promise<string>} the response from the memory LLM
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
