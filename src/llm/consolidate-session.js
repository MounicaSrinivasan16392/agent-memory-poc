/** Session-end consolidation LLM — produces semantic_profile + episodic (+ experiential). */
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

Experiential enabled: ${input.experientialEnabled ? "yes" : "no"}

Recent turns (${input.session.turnCount} total):
${turns || "(none)"}`
  );
  return parseConsolidation(raw, input);
}
function parseConsolidation(raw, input) {
  try {
    const parsed = JSON.parse(raw);
    const semanticProfile = typeof parsed.semantic_profile === "string" && parsed.semantic_profile.trim() ? parsed.semantic_profile.trim() : input.existingSemanticProfile ?? "";
    const episodic = parsed.episodic?.content?.trim() ? {
      content: parsed.episodic.content.trim(),
      importance: Number(parsed.episodic.importance ?? 0.5)
    } : null;
    const experiential = input.experientialEnabled && parsed.experiential?.content?.trim() ? {
      content: parsed.experiential.content.trim(),
      importance: Number(parsed.experiential.importance ?? 0.5)
    } : null;
    return { semanticProfile, episodic, experiential };
  } catch {
    throw new Error(`[memory] session_end LLM returned invalid JSON: ${raw.slice(0, 200)}`);
  }
}
export {
  consolidateSessionMemories
};
