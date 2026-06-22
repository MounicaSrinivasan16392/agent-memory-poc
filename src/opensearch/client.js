/** OpenSearch client factory and connectivity probe. */
import { Client } from "@opensearch-project/opensearch";
import { config } from "../config.js";
function createOpenSearchClient() {
  const { node, username, password } = config.opensearch;
  const auth = username && password ? { username, password } : void 0;
  return new Client({ node, auth });
}
async function probeOpenSearch() {
  try {
    const client = createOpenSearchClient();
    await client.ping();
    return true;
  } catch (err) {
    const meta = err.meta;
    const status = meta?.statusCode;
    const hint = status === 401 ? " \u2014 check OPENSEARCH_USERNAME/PASSWORD (quote passwords containing # in .env) or use IAM SigV4 for AWS" : status === 403 ? " \u2014 forbidden; check IAM or fine-grained access policy" : "";
    console.warn(
      `[memory] OpenSearch probe failed${status ? ` (${status})` : ""}${hint}:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
export {
  createOpenSearchClient,
  probeOpenSearch
};
