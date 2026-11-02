# Mind turn / agent / search timeouts

Single source of truth for chat and agent: `src/lib/mind/turn-timeouts.ts`.
Search budgets live in `src/lib/mind/research.ts`.

| Path | Default | Env override | Failure copy |
| --- | --- | --- | --- |
| Chat SSE (`handleMindTurn` → `relayModelStream`) | **30_000** ms | `MIND_CHAT_TIMEOUT_MS` (≥1000) | `Timed out waiting for Grok. Nothing was saved as a success.` |
| Bounded agent Run (`/api/mind/agent`) | **45_000** ms | `MIND_AGENT_TIMEOUT_MS` (≥1000) | `Timed out waiting for the planner. Nothing was marked finished.` |
| Web search (per query) | **15_000** ms | `MIND_SEARCH_TIMEOUT_MS` (≥1000) | `Search timed out. No citations were created.` |
| Deep research (overall budget) | **45_000** ms | `MIND_SEARCH_DEEP_TIMEOUT_MS` (≥1000) | `Search timed out. No citations were created.` |

Invalid or missing env values fall back to the defaults. Timeouts abort the provider or search call and return an honest error — they never hang and never invent a reply or citation.

## Disconnect vs timeout

| Situation | Copy |
| --- | --- |
| Turn / agent budget elapsed | `CHAT_TIMEOUT_REPLY` / `AGENT_TIMEOUT_REPLY` |
| Provider fetch failed or mid-stream drop (not an abort/timeout) | `Connection to the model dropped` (`CHAT_DISCONNECT_REPLY`) |

Never reuse the timeout copy for a network disconnect.

