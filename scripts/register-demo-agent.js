/**
 * One-shot registration for demo_sales_agent.
 *
 * Ensures memory_stores row, Qdrant collection, and LLM-generated memory_code.
 * Run after docker compose up: npm run register:demo
 */
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
