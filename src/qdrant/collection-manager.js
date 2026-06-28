/** Ensures one Qdrant collection per agent (vectors + payload indexes). */
import { config } from "../config.js";

function agentCollectionName(agentId) {
  const safe = String(agentId).replace(/[^a-zA-Z0-9_]/g, "_");
  return `${config.qdrant.collectionPrefix}${safe}`;
}

class CollectionManager {
  constructor(client) {
    this.client = client;
  }
  client;
  ensured = new Set();

  /** Create collection if missing — one collection per agentId. */
  async ensureAgentCollection(agentId) {
    const name = agentCollectionName(agentId);
    if (this.ensured.has(name)) return name;

    const collections = await this.client.getCollections();
    const exists = collections.collections?.some((c) => c.name === name);
    if (!exists) {
      await this.client.createCollection(name, {
        vectors: {
          size: config.embeddings.dimensions,
          distance: "Cosine"
        }
      });
      await this.client.createPayloadIndex(name, {
        field_name: "scope",
        field_schema: "keyword"
      });
      await this.client.createPayloadIndex(name, {
        field_name: "type",
        field_schema: "keyword"
      });
      await this.client.createPayloadIndex(name, {
        field_name: "is_deleted",
        field_schema: "bool"
      });
    }
    this.ensured.add(name);
    return name;
  }
}

export {
  CollectionManager,
  agentCollectionName
};
