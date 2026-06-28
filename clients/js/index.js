/**
 * @fluentmind/memory-client — JS integration surface for memory-api (gRPC).
 *
 * Re-exports the gRPC client, AI SDK tools, and token helpers.
 * Agent apps should import from here — not from src/ internals.
 */
export {
  createMemoryClient,
  MemoryClient,
} from './memory-client.js';

export { createMemoryTools } from './memory-tools.js';
export { inputTokensFromUsage, inputTokensFromGenerateText } from './usage-tokens.js';
