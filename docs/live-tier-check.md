# Live model-tier check

- At: 01/11/2026, 22:42:59 (Africa/Lagos (UTC+1))
- Secrets loaded: yes (path only; value not logged)
- Secrets path: `/home/box/.secrets/xai_inference.env`
- Prompt: `Reply with OK` · max_tokens: 16
- Mapping: `resolveModelTier` from `src/lib/mind/model-tiers.ts`

| Tier | Requested model | Returned model | OK | Status | Error / preview |
| --- | --- | --- | --- | --- | --- |
| Fast | `grok-4.20-0309-non-reasoning` | `grok-4.20-0309-non-reasoning` | yes | 200 | OK |
| Expert | `grok-4.5` | `grok-4.5` | yes | 200 | OK |
| Heavy | `grok-4.7` | `grok-4.7` | yes | 200 | OK |
| Build | `grok-build-0.1` | `grok-build-0.1` | yes | 200 | OK |
| Orchestrator | `grok-4.7` | `grok-4.7` | yes | 200 | OK |

All concrete tiers OK: **yes**

`MIND_MODEL_ORCHESTRATOR` overrides the Orchestrator default (`grok-4.7`, reasoning_effort high). Auto never selects Orchestrator. Selecting Orchestrator uses the same chat/agent resolve path as other concrete tiers (`resolveModelTier` → turn.server / agent-run.server).
