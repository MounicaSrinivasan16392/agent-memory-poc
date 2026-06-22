/** RabbitMQ handler for memory.summarize — compress Redis recent turns into summary. */
async function handleSummarize(platform, payload) {
  const job = payload;
  const memoryCode = await platform.memoryService.getMemoryCode(job.agentId);
  const result = await platform.summarizeHandler.summarize({
    agentId: job.agentId,
    conversationId: job.conversationId,
    memoryCode
  });
  if (result.updated) {
    console.log(`[memory.summarize] ${job.conversationId} \u2192 summary updated (${result.summary?.length ?? 0} chars)`);
  }
}
export {
  handleSummarize
};
