/** LLM synthesis of agent memory_code from system prompt + enabled types. */
import OpenAI from "openai";
import { config } from "../config.js";
import { loadPlatformPrompt } from "./load-prompt.js";

async function generateAgentMemoryCode(input) {
  const client = new OpenAI({ apiKey: config.openai.apiKey });
  const wrapper = loadPlatformPrompt("generate_agent_memory.md");
  const context = JSON.stringify({
    system_prompt: input.systemPrompt.slice(0, 4e3),
    types_enabled: input.typesEnabled
  });
  const response = await client.chat.completions.create({
    model: config.openai.model,
    temperature: 0.3,
    messages: [
      { role: "system", content: wrapper },
      { role: "user", content: context }
    ]
  });
  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("[memory] generateAgentMemoryCode: LLM returned empty memory_code");
  }
  return content;
}
export {
  generateAgentMemoryCode
};
