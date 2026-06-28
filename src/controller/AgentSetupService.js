/**
 * Agent registration — ensures memory_stores row, Qdrant collection, and memory_code.
 */
import { config } from "../config.js";
import { listRegisteredAgents, loadAgentPrompt, resolveAgentPrompt } from "../agents/agent-prompts.js";

class AgentSetupService {
  constructor(memoryStores, promptGenerator, memories = null) {
    this.memoryStores = memoryStores;
    this.promptGenerator = promptGenerator;
    this.memories = memories;
  }
  memoryStores;
  promptGenerator;
  memories;
  /** Register a single agent: ensure Postgres store, Qdrant collection, and memory_code. */
  async registerAgent(input) {
    const systemPrompt = resolveAgentPrompt(input.agentId, input.systemPrompt);
    if (!systemPrompt) {
      throw new Error(
        `No system prompt for "${input.agentId}". Pass systemPrompt or register in agent-prompts.js`
      );
    }
    if (this.memoryStores) {
      await this.memoryStores.ensureDefaultForAgent(input.agentId, systemPrompt);
    }
    let collectionName = null;
    if (this.memories) {
      collectionName = await this.memories.ensureAgentCollection(input.agentId);
    }
    await this.promptGenerator.generateMemoryCode({
      agentId: input.agentId,
      systemPrompt,
      typesEnabled: config.memory.typesEnabled
    });
    return { memoryCodeGenerated: true, collectionName };
  }
  async registerAllFromRegistry() {
    for (const agentId of listRegisteredAgents()) {
      const systemPrompt = loadAgentPrompt(agentId);
      if (!systemPrompt) continue;
      await this.registerAgent({ agentId, systemPrompt });
      console.log(`[setup] ${agentId} — memory_code ok`);
    }
  }
}
export {
  AgentSetupService
};
