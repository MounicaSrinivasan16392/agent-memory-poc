/**
 * Extract input (prompt) token count from AI SDK usage objects.
 * AI SDK v6 uses usage.inputTokens; older examples used promptTokens.
 */
export function inputTokensFromUsage(usage) {
  if (!usage) return 0;
  if (typeof usage.inputTokens === 'number') return usage.inputTokens;
  if (usage.inputTokens && typeof usage.inputTokens.total === 'number') {
    return usage.inputTokens.total;
  }
  if (typeof usage.promptTokens === 'number') return usage.promptTokens;
  return 0;
}

/**
 * Total input tokens for a multi-step generateText run (recall_memory + reply).
 * Uses totalUsage when present; otherwise sums per-step usage.
 */
export function inputTokensFromGenerateText(result) {
  if (!result) return 0;
  const fromTotal = inputTokensFromUsage(result.totalUsage);
  if (fromTotal > 0) return fromTotal;
  if (Array.isArray(result.steps) && result.steps.length > 0) {
    return result.steps.reduce((sum, step) => sum + inputTokensFromUsage(step.usage), 0);
  }
  return inputTokensFromUsage(result.usage);
}
