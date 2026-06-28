/** Qdrant REST client factory and connectivity probe. */
import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "../config.js";

function createQdrantClient() {
  return new QdrantClient({
    url: config.qdrant.url,
    apiKey: config.qdrant.apiKey
  });
}

async function probeQdrant() {
  try {
    const client = createQdrantClient();
    await client.getCollections();
    return true;
  } catch (err) {
    console.warn(
      "[memory] Qdrant probe failed:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

export {
  createQdrantClient,
  probeQdrant
};
