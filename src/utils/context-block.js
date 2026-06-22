/** Formats assemble output into markdown sections for LLM context injection. */
function formatContextBlock(input) {
  const sections = [];
  if (input.summary) {
    sections.push("## Session context");
    sections.push(input.summary);
  }
  if (input.recent.length > 0) {
    sections.push("## Recent turns");
    for (const turn of input.recent) {
      sections.push(`User: ${turn.user}`);
      sections.push(`Assistant: ${turn.assistant}`);
    }
  }
  if (input.memories.length > 0) {
    sections.push("## What I know about you");
    for (const mem of input.memories) {
      sections.push(`- (${mem.type}) ${mem.content}`);
    }
  }
  return sections.join("\n\n").trim();
}
export {
  formatContextBlock
};
