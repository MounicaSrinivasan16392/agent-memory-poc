/**
 * Session-end consolidation LLM.
 *
 * Reconciles existing semantic profile with session summary + recent turns.
 * Returns three optional outputs parsed from JSON:
 *   semanticProfile — merged user facts (replaces prior profile)
 *   episodic        — one session narrative
 *   experiential    — shared insight under __shared__ scope (may be null)
 */
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

/** Normalize LLM JSON — accepts string or { content } shapes; falls back to existing profile. */
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
