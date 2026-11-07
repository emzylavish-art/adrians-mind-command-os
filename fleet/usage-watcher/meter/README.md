# Usage Watcher meter

Branch: `fleet/usage-watcher/meter`

Powers the in-app meter strip: live burn, remaining credits, active brain, heaviest bot.

## Files
- `meter/latest.json` — current snapshot (interim source: Grok Bot Premium weekly shared usage until OpenAI dashboard poll is authorized)
- `meter/heartbeat.json` — last heartbeat
- `state/usage-watcher.json` — fleet status for Orchestrator/Reporter

## Rules
- Silent toward Adrian; Reporter surfaces at 50%/90% credit thresholds.
- Tag every API/usage read in the meter `tagged_calls` field.
- Never poll OpenAI dashboard without Orchestrator route + credentials.
- Never merge to main. Never deploy. Never commit secrets.
