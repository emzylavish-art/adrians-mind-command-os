# Adrian OS — Phase 1 Kimi ACP Handoff

**Status:** Local Phase 1 vertical slice implemented and protocol-smoke-tested. Windows activation remains open because no Windows execution device is attached to the session.

## Implemented

- `agent/windows/MindAgent.ps1` polls the authenticated paired-PC queue and launches typed `kimi-acp` jobs.
- `agent/windows/KimiAcpClient.mjs` launches `kimi acp`, communicates through newline-delimited ACP JSON-RPC, creates a session, submits a prompt, streams normalized events, handles workspace-restricted file reads/writes, denies terminal requests, closes the session, and reports the final result.
- `src/lib/mind/kimi/acp.server.ts` and `src/routes/api/mind/kimi/session.ts` queue and report owner-authenticated Kimi jobs.
- `src/routes/api/mind/pc/events.ts` accepts token-bound Companion events and exposes owner-authenticated event reads.
- `src/lib/mind/pc-pairing/store.ts` persists typed job payloads and bounded job events.
- The signed Companion manifest and installer include `KimiAcpClient.mjs`.
- The installer now generates the local control secret before writing configuration and accepts `-KimiPath` and `-NodePath`.

## Validation completed

- `npx tsc --noEmit` — passed.
- `node --check agent/windows/KimiAcpClient.mjs` — passed.
- Focused paired-PC/Kimi event tests — 6 passed, 0 failed.
- Production build — passed.
- Deterministic local ACP end-to-end smoke — passed:
  - `initialize`
  - `session/new`
  - `session/prompt`
  - `session/update` with `agent_message_chunk`
  - `session/close`
  - five structured event reports
  - final result report with `ok: true` and `ACP smoke passed`

The local smoke used a fake ACP process and mock dashboard only. It validates the actual worker framing and lifecycle but does not prove Kimi is installed, logged in, or running on the Windows machine.

## Remaining activation step

When the Windows machine is attached, run from the trusted `agent/windows` directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-MindAgent.ps1 `
  -DashboardUrl "https://YOUR_DASHBOARD" `
  -PairingCode "ABCD-EFGH" `
  -KimiPath "kimi" `
  -NodePath "node"
```

Then verify:

1. `kimi --version` succeeds on Windows.
2. `kimi acp` waits for JSON-RPC input without printing a banner.
3. The dashboard Companion card becomes Connected.
4. One controlled Build prompt completes from the approved `MindWorkspace` root.
5. The dashboard shows `runtime_start`, `initialized`, `session_created`, `session_update`, and `session_complete` events.
6. A terminal request is visibly denied in Phase 1; no command execution should be claimed yet.

Do not start Phase 2 until the real Windows smoke test succeeds or the owner explicitly accepts proceeding with the machine-side gate unresolved.
