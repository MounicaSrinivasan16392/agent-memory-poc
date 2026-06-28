/** Session-end consolidation LLM — produces semantic_profile + episodic + experiential. */
import { callMemoryLlm } from "./memory-llm.js";
async function consolidateSessionMemories(input) {
  const turns = input.session.recent.map((t) => `User: ${t.user}
Assistant: ${t.assistant}`).join("\n\n");
  const raw = await callMemoryLlm(
    "session_end",
    input.memoryCode,
    `Existing semantic profile:
${input.existingSemanticProfile ?? "(none)"}

Session summary:
${input.session.summary ?? "(none)"}

Recent turns (${input.session.turnCount} total):
${turns || "(none)"}`
  );
  return parseConsolidation(raw, input);
}
function parseConsolidation(raw, input) {
  try {
    const parsed = JSON.parse(raw);
    const semanticRaw = parsed.semantic_profile ?? parsed.semanticProfile;
    const episodicRaw = parsed.episodic;
    const experientialRaw = parsed.experiential;
    const semanticProfile = typeof semanticRaw === "string" && semanticRaw.trim()
      ? semanticRaw.trim()
      : input.existingSemanticProfile ?? "";
    const episodic = typeof episodicRaw === "string"
      ? episodicRaw.trim() || null
      : episodicRaw?.content?.trim() || null;
    const experiential = typeof experientialRaw === "string"
      ? experientialRaw.trim() || null
      : experientialRaw?.content?.trim() || null;
    return { semanticProfile, episodic, experiential };
  } catch {
    throw new Error(`[memory] session_end LLM returned invalid JSON: ${raw.slice(0, 200)}`);
  }
}
export {
  consolidateSessionMemories
};
