/**
 * RabbitMQ job handler: memory.summarize
 *
 * Loads agent memory_code, then folds Redis recent turns into session summary.
 */
async function handleSummarize(platform, payload) {
  const job = payload;
  const memoryCode = await platform.memoryService.getMemoryCode(job.agentId);
  const result = await platform.summarizeHandler.summarize({
    agentId: job.agentId,
    conversationId: job.conversationId,
    memoryCode
  });
  if (result.updated) {
    console.log(`[memory.summarize] ${job.conversationId} → summary updated (${result.summary?.length ?? 0} chars)`);
  }
}

export {
  handleSummarize
};
