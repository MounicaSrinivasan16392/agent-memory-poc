/** One-shot registration for demo_sales_agent (memory_stores + memory_code). */
import { createMemoryPlatform } from "../src/index.js";
async function main() {
  const platform = await createMemoryPlatform(null);
  const result = await platform.agentSetup.registerAgent({
    agentId: "demo_sales_agent"
  });
  console.log(
    `Registered demo_sales_agent — memory_code=${result.memoryCodeGenerated}, qdrant=${result.collectionName ?? "(n/a)"}`
  );
  await platform.shutdown();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
