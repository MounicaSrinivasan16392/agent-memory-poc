# Memory Code for Demo Sales Agent

## Session end (semantic reconcile + episodic)
At the end of each session, the agent will consolidate the semantic profile by merging the session's summary with recent turns. The following guidelines will be used:

- **Durable Facts to Keep**:
  - Names of clients and contacts.
  - Contact preferences (e.g., preferred communication method).
  - Budget figures discussed during the session.
  - Renewal dates for accounts.
  - Key decisions made regarding accounts or renewals.

- **Facts to Ignore**:
  - Greetings and farewells.
  - Small talk or casual conversation that does not pertain to account management or sales.
  - Any irrelevant information that does not contribute to understanding the client's needs or history.

- **Episodic Session Narrative**:
  - Write an episodic narrative if there were significant developments in the session, such as a new budget proposal, a change in renewal dates, or a decision to follow up on a specific issue. This narrative should encapsulate the key points discussed and the context around decisions made.

## Experiential (shared insights)
When the session surfaces a **reusable sales pattern** that could help other users (not one-off client facts), write a short `experiential` insight. Strip all PII — no names, companies, emails, or deal-specific identifiers. Use generic phrasing (e.g. "prospects often request phased rollout when budget is tight"). Return `null` when the session only contains client-specific facts with no broadly reusable lesson.

## Working memory summarize
For the rolling Redis session summary, the agent will focus on preserving essential short-term context while compressing less critical information:

- **What to Preserve**:
  - Names of clients and key stakeholders.
  - Important figures such as budget amounts and renewal timelines.
  - Decisions made during the session (e.g., agreeing to a follow-up meeting or confirming a renewal date).

- **What to Compress**:
  - Repetitive or non-essential dialogue that does not add value to the understanding of the client's situation.
  - Minor details that do not affect the overall account management process.

This summary will serve as a quick reference for ongoing interactions and will not be stored as long-term memory.
