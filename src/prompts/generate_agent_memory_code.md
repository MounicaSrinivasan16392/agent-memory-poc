# Generate agent memory_code

Given the agent's system_prompt, tools, datastores, and memory_types configuration,
write a single markdown **memory_code** document the platform uses for memory jobs.

Platform behavior (do not contradict):
- **Semantic long-term memory** is written only at **session end** — not per turn.
- **Summarize** updates Redis working memory only (rolling summary + recent turns) — not the semantic profile.

The memory_code must include these sections:

## Session end (semantic reconcile + episodic)
How to merge/dedup the semantic profile from the full session (summary + recent turns).
What durable facts to keep vs ignore. When to write an episodic session narrative.

## Experiential (shared insights) — include when `experiential` is in types_enabled
When to write a shared, PII-stripped insight reusable across users (`experiential` JSON field at session end).
What counts as a reusable pattern vs client-specific facts that belong only in semantic/episodic.
Require generic phrasing with no names, companies, or identifiers.

## Working memory summarize
What to preserve vs compress in the rolling Redis session summary (names, figures, decisions).
This is short-term context only — not long-term semantic storage.

Output markdown only — no JSON. Be specific to the agent's domain.
