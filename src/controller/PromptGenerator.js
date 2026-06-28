/**
 * Generates and persists agent memory_code at registration time.
 *
 * Flow: LLM (prompt-generator.js) → postgres memory_stores → mirror file on disk.
 */
import { generateAgentMemoryCode } from "../llm/prompt-generator.js";
import { saveMemoryCodeFile } from "../prompts/memory-code-files.js";

class PromptGenerator {
  constructor(postgres) {
    this.postgres = postgres;
  }
  postgres;

  /** Generate memory_code from system prompt; save to postgres + src/prompts/memory_code/. */
  async generateMemoryCode(input) {
    const memoryCode = await generateAgentMemoryCode({
      systemPrompt: input.systemPrompt,
      typesEnabled: input.typesEnabled
    });
    if (this.postgres) {
      const store = await this.postgres.ensureAgentStore(input.agentId, input.systemPrompt);
      await this.postgres.updateMemoryCode(store.id, memoryCode);
    }
    saveMemoryCodeFile(input.agentId, memoryCode);
    return { memoryCode };
  }
}

export {
  PromptGenerator
};
