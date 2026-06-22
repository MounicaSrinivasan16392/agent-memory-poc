/**
 * Agent registration — ensures memory_stores row and generates memory_code.
 */
import { listRegisteredAgents, loadAgentPrompt, resolveAgentPrompt } from "../agents/agent-prompts.js";
class AgentSetupService {
  constructor(memoryStores, promptGenerator) {
    this.memoryStores = memoryStores;
    this.promptGenerator = promptGenerator;
  }
  memoryStores;
  promptGenerator;
  /** Register a single agent: ensure store + generate memory_code. */
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
    const typesEnabled = input.typesEnabled ?? ["semantic", "episodic"];
    await this.promptGenerator.generateMemoryCode({
      agentId: input.agentId,
      systemPrompt,
      typesEnabled,
      experientialEnabled: input.experientialEnabled ?? false
    });
    return { memoryCodeGenerated: true };
  }
  async registerAllFromRegistry(options) {
    for (const agentId of listRegisteredAgents()) {
      const systemPrompt = loadAgentPrompt(agentId);
      if (!systemPrompt) continue;
      await this.registerAgent({
        agentId,
        systemPrompt,
        experientialEnabled: options?.experientialEnabled
      });
      console.log(`[setup] ${agentId} — memory_code ok`);
    }
  }
}
export {
  AgentSetupService
};
