import { generateAgentMemoryCode } from "../llm/prompt-generator.js";
import { saveMemoryCodeFile } from "../prompts/memory-code-files.js";
/**
 * Generates and persists agent memory_code (LLM extraction policy) at registration.
 */
class PromptGenerator {
  /**
   * @param memoryStores Postgres repository for agent memory store metadata.
   */
  constructor(memoryStores) {
    this.memoryStores = memoryStores;
  }
  memoryStores;
  /**
   * Create and save a memory_code policy for an agent.
   */
  async generateMemoryCode(input) {
    const memoryCode = await generateAgentMemoryCode({
      systemPrompt: input.systemPrompt,
      typesEnabled: input.typesEnabled
    });
    if (this.memoryStores) {
      const store = await this.memoryStores.ensureDefaultForAgent(input.agentId, input.systemPrompt);
      await this.memoryStores.updateMemoryCode(store.id, memoryCode);
    }
    saveMemoryCodeFile(input.agentId, memoryCode);
    return { memoryCode };
  }
}
export {
  PromptGenerator
};
