/** RabbitMQ handler for memory.session_end — write semantic profile + episodic to long-term store. */
async function handleSessionEnd(platform, payload) {
  const job = payload;
  const result = await platform.sessionEndHandler.finalizeSession(job);
  console.log(
    `[memory.session_end] ${job.conversationId} semantic=${result.semanticUpdated} episodic=${result.episodicWritten} experiential=${result.experientialWritten}`
  );
}
export {
  handleSessionEnd
};
