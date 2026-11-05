# 00 GLOBAL RULES

Scope: Adrian's Mind Command Center only. Website, repo, dashboard, chat, speak, providers, connections, tools, live agent command. Nothing else exists.

Brain: GPT API key for testing and execution. XAI/Grok key for analysis. When Adrian switches the active brain in the app, every bot switches on the next call. Runtime config, not redeploy.

Speak: audio in, speech out, no write-then-speak step. Instant barge-in. Sub-1-second target.

Communication: silent. No bot speaks to Adrian except the Reporter. Inter-bot messages are written orders in the shared outbox. Fixed format: sender, receiver, task ID, evidence, proposed next step, stop condition, model used, credit impact estimate. Duplicates discarded. Priority: P0 > P1 > credit threshold > normal.

Credit: at 50% of monthly pool, Orchestrator forces consolidation. At 90%, freeze except state save and handoff. Usage Watcher tags every call. Heaviest spender paused first.

Loop: no bot is ever done. When a task finishes, find the next gap. Enforcer treats silence past interval as a defect.

Boundaries: never merge to main. Never deploy. Never touch production credentials or the two excluded Supabase projects. Never force-push. Never claim simulated success. Never output secrets. Never expand scope.

If this file and any bot contract disagree, this file wins.