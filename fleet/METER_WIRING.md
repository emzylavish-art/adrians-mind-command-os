# IN-APP USAGE METER WIRING SPEC
ADRIAN'S MIND COMMAND CENTER
AUTO-EXECUTED BY FLEET BOTS
NO HUMAN APPROVAL REQUIRED TO FOLLOW

═══════════════════════════════════════
1. PURPOSE
═══════════════════════════════════════

The in-app usage meter lives in the Command Center shell (not settings). It shows live burn rate, remaining credits, active brain, and per-bot spend. This file tells every AI building or maintaining the meter exactly how to wire it to Usage Watcher's outbox so the numbers are real, not mocked.

═══════════════════════════════════════
2. DATA SOURCE
═══════════════════════════════════════

- Usage Watcher writes one JSON line per cycle to the shared outbox on its branch: fleet/usage-watcher/meter/outbox.jsonl
- Each line: {"ts": ISO timestamp, "bot": name, "model": name, "tokens_in": n, "tokens_out": n, "cost_usd": n, "brain": "gpt" or "xai", "task_id": string}
- The meter reads this file (or the aggregated summary the Usage Watcher also writes to fleet/usage-watcher/meter/summary.json) and renders it.
- If the outbox file is missing or stale past two cycles, the meter shows "stale" with the last-known values, never fake zeros.

═══════════════════════════════════════
3. WHAT THE METER DISPLAYS
═══════════════════════════════════════

Compact strip (always visible in shell):
- Live burn rate (USD per hour, rolling)
- Remaining monthly headroom
- Active brain (GPT or xAI) with its tone
- Heaviest spender bot name

Expanded view (tap to open):
- Per-bot breakdown with token counts
- Per-provider breakdown
- Per-session breakdown
- Credit throttle status (normal / consolidating at 50% / frozen at 90%)
- Reset date for the weekly pool

═══════════════════════════════════════
4. RULES FOR ANY AI TOUCHING THIS
═══════════════════════════════════════

- Never hard-code usage numbers in the meter component. All values come from the outbox.
- Never show a number the outbox did not produce.
- If Usage Watcher is paused, the meter says so explicitly.
- The meter must not itself make API calls to OpenAI or xAI. It reads files only.
- Adding a new provider to the fleet requires adding its tone to the provider-tone table in the global contracts before the meter can display it.

═══════════════════════════════════════
5. VERIFICATION
═══════════════════════════════════════

Integration Verifier confirms the meter renders real outbox data by checking that a known test line in the outbox appears in the meter UI. Error Bot flags any meter value that cannot be traced to an outbox line.

END OF METER WIRING SPEC