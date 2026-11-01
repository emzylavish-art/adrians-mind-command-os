# Mind turn / agent timeouts

Single source of truth: `src/lib/mind/turn-timeouts.ts`.

| Path | Default | Env override | Failure copy |
| --- | --- | --- | --- |
| Chat SSE (`handleMindTurn` → `relayModelStream`) | **30_000** ms | `MIND_CHAT_TIMEOUT_MS` (≥1000) | `Timed out waiting for Grok. Nothing was saved as a success.` |
| Bounded agent Run (`/api/mind/agent`) | **45_000** ms | `MIND_AGENT_TIMEOUT_MS` (≥1000) | `Timed out waiting for the planner. Nothing was marked finished.` |

Invalid or missing env values fall back to the defaults. Timeouts abort the provider call and return an honest error — they never hang and never invent a reply.
