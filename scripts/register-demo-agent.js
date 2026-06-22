/** One-shot registration for demo_sales_agent (memory_stores + memory_code). */
import { createMemoryPlatform } from "../src/index.js";
async function main() {
  const platform = await createMemoryPlatform(null);
  const result = await platform.agentSetup.registerAgent({
    agentId: "demo_sales_agent",
    typesEnabled: ["semantic", "episodic"],
    experientialEnabled: false
  });
  console.log(`Registered demo_sales_agent \u2014 memory_code=${result.memoryCodeGenerated}`);
  await platform.shutdown();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
