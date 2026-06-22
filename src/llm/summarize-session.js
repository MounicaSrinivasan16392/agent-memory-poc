/** Redis summarize LLM — folds evicted turns into one rolling summary JSON. */
import { callMemoryLlm } from "./memory-llm.js";


async function summarizeSessionWithLlm(input) {
  if (input.evictedTurns.length === 0) {
    throw new Error("[memory] summarize called with no evicted turns");
  }
  const turns = input.evictedTurns.map((t, i) => `Turn ${i + 1}:
User: ${t.user}
Assistant: ${t.assistant}`).join("\n\n");
  const raw = await callMemoryLlm(
    "summarize",
    input.memoryCode,
    `Compress into ONE replacement rolling summary. The previous summary below will be discarded \u2014 fold it and the evicted turns into a single new prose summary. Do not append as a separate section.

Previous summary (replace entirely):
${input.previousSummary ?? "(none)"}

Turns leaving the raw window (fold into the new summary):
${turns}`
  );
  try {
    const parsed = JSON.parse(raw);
    const summary = parsed.summary?.trim();
    if (!summary) {
      throw new Error("missing summary field");
    }
    return summary;
  } catch {
    throw new Error(`[memory] summarize LLM returned invalid JSON: ${raw.slice(0, 200)}`);
  }
}
export {
  summarizeSessionWithLlm
};
