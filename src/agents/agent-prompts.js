/**
 * Agent system prompt registry — maps agent_id to src/prompts/*.md files.
 * Used at RegisterAgent to derive memory_code when no inline systemPrompt is passed.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../prompts");
const AGENT_PROMPT_FILES = {
  demo_sales_agent: "demo_sales_agent_prompt.md"
};
function loadAgentPrompt(agentId) {
  const file = AGENT_PROMPT_FILES[agentId];
  if (!file) return null;
  return readFileSync(join(PROMPTS_DIR, file), "utf8");
}
function resolveAgentPrompt(agentId, systemPrompt) {
  const trimmed = systemPrompt?.trim();
  if (trimmed) return trimmed;
  return loadAgentPrompt(agentId);
}
function listRegisteredAgents() {
  return Object.keys(AGENT_PROMPT_FILES);
}
export {
  listRegisteredAgents,
  loadAgentPrompt,
  resolveAgentPrompt
};
