/** OpenAI embedding helper for episodic/experiential vector search. */
import OpenAI from "openai";
import { config } from "./config.js";
let client = null;
function getClient() {
  if (!config.openai.apiKey) {
    throw new Error("[memory] OPENAI_API_KEY required for embeddings");
  }
  if (!client) client = new OpenAI({ apiKey: config.openai.apiKey });
  return client;
}
async function embedText(text) {
  const openai = getClient();
  const res = await openai.embeddings.create({
    model: config.embeddings.model,
    input: text,
    dimensions: config.embeddings.dimensions
  });
  const embedding = res.data[0]?.embedding;
  if (!embedding) {
    throw new Error("[memory] embeddings API returned no vector");
  }
  return { embedding, tokensUsed: res.usage?.total_tokens ?? 0 };
}
export {
  embedText
};
