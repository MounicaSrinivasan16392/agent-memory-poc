/**
 * RabbitMQ worker entry point.
 *
 * Consumes memory.# routing keys and delegates to job handlers:
 *   memory.summarize    → fold recent turns into Redis summary
 *   memory.session_end  → consolidate into long-term postgres + qdrant
 */
import "dotenv/config";
import { createMemoryPlatform } from "../index.js";
import { handleSummarize } from "./jobs/summarize.js";
import { handleSessionEnd } from "./jobs/session_end.js";
import { startJobConsumer } from "../queue/rabbitmq.js";

async function main() {
  const platform = await createMemoryPlatform(null);
  await startJobConsumer(async (routingKey, payload) => {
    switch (routingKey) {
      case "memory.summarize":
        await handleSummarize(platform, payload);
        break;
      case "memory.session_end":
        await handleSessionEnd(platform, payload);
        break;
      default:
        console.warn(`[memory-worker] unknown routing key: ${routingKey}`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
