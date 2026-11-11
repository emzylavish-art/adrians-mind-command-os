# Adrian OS — Phase 3 Handoff

**Status:** Phase 3 implementation is complete in code and locally validated. The full product blueprint continues with later phases, but this phase’s native Build workspace and its execution controls are implemented.

The Build view now provides a native Adrian OS workspace shell with Agent, Timeline, Changes, Editor, and Terminal panels. It submits real Kimi tasks through the authenticated ACP session API, streams stored ACP events, restores the last session after refresh, and exposes an owner Stop task control that requests cancellation and is honored by the Companion worker.

The Editor panel is backed by authenticated Companion file-operation jobs. Browse queues a bounded workspace listing, selecting a file queues a bounded read, and Save reviewed file queues a bounded write. Writes return before/after content and the Changes panel renders that review payload. All file paths are checked against configured Companion allowed roots, with traversal rejected and content/output limits enforced.

The Terminal panel is backed by the existing approval infrastructure. Request approval creates a short-lived owner approval containing the exact command. Approve exact command consumes that approval and queues a `confirm: true` shell job. The Companion runs the command with bounded output and a timeout, reports terminal start/complete events, and refuses unapproved shell jobs. ACP reverse terminal requests remain denied unless they come through this explicit owner-approval path.

Validation completed successfully:

- `npm run build` — passed.
- `npx tsc --noEmit` — passed.
- `node --check agent/windows/KimiAcpClient.mjs` — passed.
- `npx eslint src/components/mind/build-workspace.tsx` — passed.
- Pairing and approval regression tests — 12 passed, 0 failed.
- File-operation Companion smoke — passed for reviewed write and before/after result.
- Approved terminal Companion smoke — passed for bounded command output.
- Cancellation smoke — passed; active ACP child received cancellation polling, was terminated, and reported failure honestly.

The real Windows Companion was not activated in this session because no Windows device was attached. That remains a deployment/runtime verification item, not an unimplemented Phase 3 code contract. Vercel deployment is also intentionally deferred to the release phase; Vercel hosts the control plane, while Kimi and local file/terminal execution require an attached runtime.

## Key files

- `src/components/mind/build-workspace.tsx`
- `src/lib/mind/kimi/acp.server.ts`
- `src/lib/mind/kimi/files.server.ts`
- `src/routes/api/mind/kimi/session.ts`
- `src/routes/api/mind/kimi/files.ts`
- `src/routes/api/mind/kimi/terminal.ts`
- `src/routes/api/mind/kimi/cancel.ts`
- `src/routes/api/mind/pc/jobs.ts`
- `src/lib/mind/pc-pairing/store.ts`
- `agent/windows/KimiAcpClient.mjs`
- `agent/windows/MindAgent.ps1`
