# Manus merge and deploy handoff

Branch: `fleet/orchestrator/manus-execution-phases`

Status: Local-computer implementation of the Grok Build + Manus execution blueprint is complete. 89 tests passed (`python -m unittest discover -s team -p 'test_*.py'`, 2026-11-10 11:50 UTC). The earlier run before the Notion write-back test was 88.

## What is ready

- Orchestrator routing and logging
- Local one-step-at-a-time computer with file-as-memory and resume
- Automations that enqueue into the existing queue
- Kill switch, approval, and budget gates
- Fleet wake records only
- Manifest and worker allowlist updated

## What is intentionally blocked

Cloud Manus (API and webhook) is refused until `MANUS_API_KEY` or `MANUS_WEBHOOK_URL` is set and a successful response is recorded. No cloud claim is made.

## Notion write-back

Wired. After a successful `synthesize`, the orchestrator always builds the exact `notion.controller` `append-text` payload below. The live append runs only when all three are present: `notion_page_id`, an approval record (`approved: true` plus an id), and `NOTION_API_KEY`. If any one is missing, nothing is sent and the payload is returned in `notion_writeback.deferred`. This branch did not have `NOTION_API_KEY`, so the live call was deferred. A unit test covers the gated send with a fake append and does not call Notion.

Exact payload:

```json
{
  "tool_id": "notion.controller",
  "input": {
    "action": "append-text",
    "id": "<notion_page_id>",
    "text": "<summary>\nArtifacts: <artifact file list>\nEvidence: <evidence log>\nLimitations: <limitations>\n<one-line log>"
  },
  "condition": "Runs only when notion_page_id is a Notion page id, approval.approved is true with an id, and NOTION_API_KEY is set. Otherwise nothing is sent."
}
```

## Worker smoke test

Command: enqueue `tool_id` `team.manus` with `transport` `local`, then `worker.process_one`.

Result:

```json
{
  "queued_id": "02deb643-848e-4700-8624-66c70fb4c075",
  "worker_status": "succeeded",
  "runner_status": "partial",
  "cursor": 1,
  "step_file_exists": true,
  "step_file": "computers/smoke/objective.md",
  "memory_cursor": 1,
  "memory_done": ["objective.md"]
}
```

The runner dispatched `team.manus`. One step file was written. `memory.json` cursor is 1. No registration gap.

## Explicit statement

No pull request was opened. No merge was performed. No production deploy was performed. The live site is unchanged.

## Instruction to Manus

Merge this branch together with the other pending assets and deploy to production. This branch is ready for that merge.

## One-line log

2026-11-10 11:50 | GROK-BUILD | HANDOFF | WRITTEN | MANUS MERGE AND DEPLOY
