# FluentMind memory client (JavaScript)

Copy this folder into your JS agent builder.

| File | Role |
|------|------|
| `memory-client.js` | gRPC client for memory-api |
| `memory-tools.js` | Vercel AI SDK tools (recall, append, search, …) |
| `chat-demo.js` | Runnable demo server — `npm run chat` |
| `chat-ui/` | Static UI served by the demo |
| `index.js` | Barrel exports |

Agents import **only** from here — never from `src/`.
