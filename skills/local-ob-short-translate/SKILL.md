# local obligation: short-translate

## Purpose
Named always-on obligation under group `comms` for Adrian Mind OS local-model-runner.

## When to use
Delegate here when the task matches `short-translate` and can stay local (Tier 1 doorman or Tier 2 worker). Escalate to cloud (Tier 3) only if confidence &lt; 0.8 or the job flags uncertain.

## Trigger
- schedule: runner interval / jobs/ drop-in JSON file named with this job
- event: matching filesystem, log, health, or API signal
- manual: POST /run with `{"job":"short-translate"}`

## Input schema
```json
{
  "job": "short-translate",
  "payload": {
    "paths": ["string"],
    "text": "string",
    "headers": {},
    "extra": {}
  }
}
```

## Output schema
```json
{
  "ok": true,
  "job": "short-translate",
  "result": {},
  "proposal_paths": ["review/<timestamp>-short-translate.md"]
}
```

## Failure mode
On failure write error JSON to output/ and propose review only. Never delete/send/deploy/commit.

## Safety (hard)
- Proposes, queues, drafts, flags, summarizes only
- Never deletes, sends, deploys, or commits
- Every proposal lands in `local-model/review/` with timestamp for Adrian or cloud approval
- Blueprints are read-only citations, never reinvented

## No-loose-ends rule
Agents using this skill do not stop until the installer builds, installs, boots, and this loop is proven on a clean machine path (or documented as owner-PC-only if host-bound).

## Related
- Parent skill: `skills/local-model-runner/SKILL.md`
- Catalog: `desktop/engines/local-model/jobs-catalog.json`
- Endpoint: `http://127.0.0.1:9400`
