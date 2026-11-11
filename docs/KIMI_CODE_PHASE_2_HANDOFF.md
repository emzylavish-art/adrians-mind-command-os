# Adrian OS — Phase 2 Functional Build Milestone

**Status:** Implemented and locally validated. This milestone advances the product surface without requiring the Windows machine to be attached.

## What changed

The Build sidebar view no longer renders a passive placeholder. It now mounts `src/components/mind/build-workspace.tsx`, which provides:

- Honest Companion readiness status with refresh behavior.
- Approved workspace path input.
- Coding-task prompt input.
- Real `POST /api/mind/kimi/session` submission.
- Queued/running/completed/error state display.
- Live polling of the ACP event stream.
- Agent output rendering from `agent_message_chunk` events.
- Execution timeline for runtime start, initialization, session creation, agent updates, permission requests, terminal denials, file writes, completion, and errors.
- Explicit no-op behavior when no Companion is online.
- Clear safety copy that terminal requests remain approval-gated.

The existing command app now delegates Build rendering to the new component instead of maintaining placeholder-only suggestion state.

## Validation

- `npx tsc --noEmit` — passed.
- `npm run build` — passed.
- `npx eslint src/components/mind/build-workspace.tsx` — passed.
- Focused paired-PC/Kimi event tests — 6 passed, 0 failed.

## What is intentionally not claimed yet

- No full Monaco/editor integration.
- No project explorer or file tree browsing UI.
- No terminal execution UI; ACP terminal requests are denied in the current runtime worker.
- No diff review/accept/reject workflow.
- No persistent Build project/session database entities.
- No real Windows Companion activation in this session.
- No Vercel deployment or production migration.

## Next milestone

The next implementation milestone should add persistence and lifecycle controls around this thin workspace: Build project/workspace records, resumable session metadata, cancellation, reconnect/recovery, and event retention. After that, the larger editor/explorer/diff/terminal interface can be added without replacing the authenticated ACP boundary.
