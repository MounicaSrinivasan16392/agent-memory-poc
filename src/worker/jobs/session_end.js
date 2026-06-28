/** RabbitMQ handler for memory.session_end — write semantic profile + episodic to long-term store. */
async function handleSessionEnd(platform, payload) {
  const job = payload;
  const snap = job.sessionSnapshot;
  const detail = snap
    ? `turns=${snap.turnCount} recent=${snap.recent?.length ?? 0} summary=${snap.summary?.length ?? 0}ch`
    : "no snapshot";
  const result = await platform.sessionEndHandler.finalizeSession(job);
  const flags = `semantic=${result.semanticUpdated} episodic=${result.episodicWritten} experiential=${result.experientialWritten}`;
  if (result.skippedReason) {
    console.log(`[memory.session_end] ${job.conversationId} (${detail}) skipped: ${result.skippedReason}`);
    return;
  }
  console.log(`[memory.session_end] ${job.conversationId} (${detail}) ${flags}`);
}
export {
  handleSessionEnd
};
