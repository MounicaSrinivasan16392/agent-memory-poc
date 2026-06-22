import { generateAgentMemoryCode } from "../llm/prompt-generator.js";
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
   * Calls the LLM to synthesize extraction rules from the system prompt, tools, and
   * enabled memory types, then persists the result on the agent's memory store record.
   *
   * @param input.agentId Agent identifier.
   * @param input.systemPrompt Full agent system prompt used to derive extraction policy.
   * @param input.tools Optional tool definitions referenced in the memory_code.
   * @param input.datastores Optional datastore definitions referenced in the memory_code.
   * @param input.typesEnabled Memory types the agent may read and write.
   * @param input.experientialEnabled Whether shared experiential insights are enabled.
   * @returns Generated memory_code markdown string.
   *
   * Used by: AgentSetupService.registerAgent, grpc/server, examples.
   */
  async generateMemoryCode(input) {
    const memoryCode = await generateAgentMemoryCode({
      systemPrompt: input.systemPrompt,
      tools: input.tools,
      datastores: input.datastores,
      typesEnabled: input.typesEnabled,
      experientialEnabled: input.experientialEnabled
    });
    if (this.memoryStores) {
      const store = await this.memoryStores.ensureDefaultForAgent(input.agentId, input.systemPrompt);
      await this.memoryStores.updateMemoryCode(store.id, memoryCode);
    }
    return { memoryCode };
  }
}
export {
  PromptGenerator
};
