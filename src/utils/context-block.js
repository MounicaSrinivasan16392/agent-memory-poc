/**
 * Formats ContextAssembler output into markdown sections for LLM injection.
 *
 * Section order: session summary → recent turns → semantic profile → recalled memories.
 */
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
  if (input.semanticProfile) {
    sections.push("## What I know about you");
    sections.push(input.semanticProfile);
  }
  if (input.memories.length > 0) {
    sections.push("## Recalled memories");
    for (const mem of input.memories) {
      sections.push(`- (${mem.type}) ${mem.content}`);
    }
  }
  return sections.join("\n\n").trim();
}

export {
  formatContextBlock
};
