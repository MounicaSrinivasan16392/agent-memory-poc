# Agent memory_code files (generated)

These files are **mirrors** of `memory_stores.memory_code` in Postgres. They are written when you run:

```bash
npm run register:demo
# or RegisterAgent gRPC
```

Runtime jobs (summarize, session_end) load memory_code from **Postgres**, not from this folder.

## How this differs from `platform.memory.system.md`

| File | Role |
|------|------|
| `platform.memory.system.md` | Platform invariants + JSON task schemas (same for all agents) |
| `memory_code/{agentId}.md` | Agent-specific extraction policy (what to remember, compress, ignore) |

Both are sent to the memory LLM: platform = system message, memory_code = `AGENT_MEMORY_CODE` in the user message.
