# Adrian OS — Phase 0 Kimi Code Integration Audit

**Audit date:** 2026-11-10  
**Repository:** `emzylavish-art/adrians-mind-command-os`  
**Audited revision:** `a606c2c641bf311d3bf094d8739b3fbba2bdd1dd`  
**Audit scope:** Phase 0 only. No application implementation, UI rewrite, production deployment, or database migration was performed.

## Phase 0 conclusion

Phase 0 is complete as an architecture and compatibility audit. The repository is a TanStack Start application with a single command-center shell. Build is already visible in the sidebar, but it is currently an honest guarded placeholder: it does not edit a repository, run a terminal, install packages, or execute an agent task. The codebase contains reusable authentication, owner isolation, provider routing, MCP registries, agent/run records, voice modules, pairing protocols, approval controls, and audit-related records. It does not contain a Kimi Code adapter, a verified Kimi runtime process, a connected Windows Companion, or a Build-specific session/event contract.

The smallest technically credible integration route is a Kimi Code CLI child process launched in ACP mode (`kimi acp`) by a trusted runtime on the paired Windows machine. Adrian OS should act as the control plane and authenticated session/event UI; the Windows Companion should supervise the Kimi process and enforce the workspace and terminal boundary. The ACP channel is JSON-RPC over stdin/stdout. It is not safe or sufficient to treat ACP as a public HTTP endpoint or to assume it provides every Kimi feature automatically.

The Phase 1 gate is therefore: define and implement a typed internal adapter around the verified ACP surface, launch one real Kimi session in one approved workspace, submit one prompt, stream ACP updates, capture permission/tool/file/terminal events, and close or cancel the session. Do not begin a large Build UI rewrite before this vertical slice works.

## 1. Repository and architecture inventory

### Application shell and Build surface

- `src/components/mind/command-app.tsx` is the primary authenticated application shell and owns the sidebar, command modes, workspace state, provider controls, voice controls, and view selection.
- `Build` is a view inside `CommandApp`, not a separate page route. The relevant view state and navigation entries are around `command-app.tsx:279`, `:345`, and `:5266`.
- The current Build view explicitly states that it does not edit repositories, run a terminal, install packages, or create commits. Suggestion cards only select text and report that nothing was executed.
- The current Build UI displays pairing status through `pcAgentOnline` and `pcAgentDetail`, but it does not submit a coding task to a runtime.
- There is no Build-specific route, session API, event stream, editor surface, file explorer, diff review, terminal panel, or Kimi adapter.

### Existing server and agent surfaces

- `src/routes/api/mind/agent.ts` exposes `POST /api/mind/agent`.
- `src/lib/mind/agent-run.server.ts` implements a bounded, authenticated planner-like run backed by the existing Grok/xAI adapter. It builds an in-memory workspace from supplied names and calls `runBoundedAgent`.
- `src/lib/mind/agent.ts`, `src/lib/mind/agent-session.ts`, `src/lib/mind/fleet.ts`, and `src/lib/mind/workbench-command.ts` provide reusable agent/run concepts, but the current worker is intentionally bounded and does not execute a general coding agent.
- `migrations/0003_fleet.sql` contains owner-scoped tables for agents, runs, events, connections, mailboxes, schedules, and deployments.
- `docs/AGENT_RUNTIME.md` correctly states that the current system is not a hosted process, a model-in-the-loop swarm, or a general coding runtime.

### Authentication, isolation, approvals, and emergency stop

- `src/lib/auth/verify.server.ts` and `src/lib/auth/middleware.ts` provide server-side identity gates.
- `src/lib/mind/isolation.ts` blocks forbidden environment/database references.
- `src/lib/mind/policy.ts`, `src/lib/mind/execution-gate.ts`, and the halt modules provide action policy, owner approval, and emergency-stop behavior.
- `src/lib/mind/pairing/scope.ts` already classifies device actions into file-read, file-write, file-delete, and terminal scopes and rejects several Windows path and command hazards.
- `src/routes/api/mind/pc/approve.ts` requires an authenticated same-origin human approval and consumes a one-time approval before running an approved paired-PC command.
- These controls are reusable, but they have not yet been bound to Kimi ACP session/tool events. Phase 1 must make that binding explicit rather than allowing ACP messages to bypass existing policy.

### Pairing and Windows Companion foundation

The repository contains a real pairing protocol foundation, but not a verified running Windows Companion:

- Pairing HTTP routes exist under `src/routes/api/mind/pairing/`: code minting, handshake, status, heartbeat, signed manifest, action signing/reporting, token rotation, and emergency stop.
- Paired-PC queue routes exist under `src/routes/api/mind/pc/`: register, status, jobs, result, approvals, approve, and deny.
- `src/lib/mind/pairing/` contains the pairing store, handshake, transport checks, integrity/manifest logic, heartbeat status, scope checks, redaction, and emergency-stop code.
- `src/lib/mind/pc-pairing/` contains the simpler PC job store, approvals, and paired-agent execution wrapper.
- Device/pairing state is file-backed under `.data/` in this checkout. Existing project documentation says that this is not durable cloud persistence when `DATABASE_URL` is absent.
- `agent/windows/` and the pairing installer/configuration paths must be inspected on the actual Windows machine before claiming Companion readiness. The repository does not establish that a Companion process is installed, online, or supervising Kimi.

### MCP and provider infrastructure

- `.mcp.json` registers the repository's stdio MCP server, the legacy GPT proxy, and a Cloudflare MCP URL as client configuration examples.
- `team/mcp_server.py`, `team/mcp_http.py`, and `team/remote_mcp.py` implement separate local, hosted, and explicitly allowlisted remote MCP paths.
- `src/lib/mind/mcp/`, `src/routes/api/mind/mcp/`, `src/lib/mind/connected-mcp.server.ts`, and migrations `0005_custom_connection.sql` and `0007_oauth_connections.sql` provide application-side MCP registry and connector surfaces.
- `src/lib/mind/provider-call.ts`, `src/lib/mind/providers.ts`, `src/lib/mind/ai-provider-config.server.ts`, and `team/provider_router.py` provide existing provider/configuration patterns. The main chat path currently uses Grok/xAI and does not provide a Kimi Code runtime adapter.
- Kimi's ACP server can forward `http`, `stdio`, and `sse` MCP configurations supplied at session creation/loading time. ACP transport MCP servers are discarded by Kimi with a warning, so Adrian OS must classify supported and unsupported MCP transports honestly.

### Voice and persistence

- Adrian Speak and realtime/one-shot voice code exists under `src/lib/mind/voice/`, `src/lib/mind/voice-live/`, and related components/routes.
- Voice is not part of the Phase 1 minimum. Kimi's current ACP capability table reports audio prompt support as false. Voice should later submit text/transcript instructions into the same Build session rather than pretending that ACP accepts audio blocks.
- `migrations/0002_mind.sql` provides owner-scoped project, chat, memory, file, audit, and usage tables.
- `migrations/0003_fleet.sql` provides owner-scoped agent/run/event records.
- The repository currently uses a browser snapshot and local PGLite fallback when no dedicated database URL is configured. This is not equivalent to verified cloud persistence.

## 2. Kimi Code compatibility report

### Upstream identity and provenance

The official upstream repository is `MoonshotAI/kimi-code` and is released under the MIT License. The official repository describes Kimi Code CLI as a terminal coding agent that can read and edit code, run shell commands, search files, fetch web pages, and choose subsequent actions based on tool feedback. The official documentation's release page lists **Kimi Code CLI v2.5.0 on 2026-11-04** as the current documented CLI release at audit time.

Observed upstream repository metadata during this audit:

- Official repository: `https://github.com/MoonshotAI/kimi-code`
- Upstream `HEAD` observed: `7490d07d358d1f6736cf87abf7a7ae22d6ea8897`
- Repository package root metadata: `@moonshot-ai/monorepo`, version `0.1.1`, license `MIT`, `pnpm@10.33.0`, Node `>=24.15.0`
- The package-root version is monorepo metadata and should not be substituted for the CLI release number. Phase 1 must pin an exact upstream tag/commit after testing the installed CLI binary.

### Verified integration mechanism

The official supported IDE integration is ACP:

```text
kimi acp
```

The command starts an ACP server as a child process. It prints no banner to stdout and waits for an ACP `initialize` JSON-RPC request on stdin. Diagnostics go to stderr and Kimi's diagnostic log, which keeps stdout available for protocol messages. Official documentation says the IDE reuses the CLI's existing authentication state for each session.

This makes ACP the preferred Phase 1 boundary because it is a documented protocol surface rather than an invented HTTP API. Adrian OS should not claim that an ACP connection is complete until it implements the required client-side reverse-RPC handlers and tests the actual installed Kimi version.

### ACP capabilities relevant to Phase 1

The official ACP reference reports these agent-side capabilities:

- `initialize`, `authenticate`, and `logout`.
- `session/new` accepting `cwd`, `mcpServers`, and `additionalDirectories`.
- `session/load`, `session/resume`, `session/list`, `session/fork`, `session/close`, and `session/delete`.
- `session/prompt` with text, image, resource, and resource-link blocks.
- `session/cancel`, `session/set_mode`, and `session/set_config_option`.
- `session/set_model` as an extension method.

The agent-to-client reverse-RPC surface includes:

- `session/update` for assistant chunks, tool-call lifecycle, plans, configuration updates, and available commands.
- `session/request_permission` for tool approvals and questions.
- `fs/read_text_file` and `fs/write_text_file`.
- `terminal/create`, `terminal/output`, `terminal/release`, `terminal/kill`, and `terminal/wait_for_exit`.
- `elicitation/create` when the client advertises the corresponding capability.

The ACP reference says the current server implements the core and session surfaces, 10 of 11 listed client reverse-RPC methods, and `session/set_model`. It does not implement `providers/*`, `nes/*`, `document/*`, or `elicitation/complete`. Adrian OS must expose unsupported features as unsupported rather than mapping them to fake controls.

### Kimi features that fit the blueprint

The upstream README and release documentation support the blueprint's intended categories: coding agent behavior, file and shell tools, project instructions, lifecycle hooks, MCP configuration, plugins, skills, subagents, and session management. The official v2.5.0 notes also describe remote SSH/Docker/custom-command environments, forking, live model/effort changes, and multi-directory projects.

These features remain upstream capabilities, not Adrian OS capabilities. Each must later be classified as fully integrated, integrated with limitations, unsupported, or planned. Phase 0 does not mark any of them as complete inside Adrian OS.

### Important compatibility constraints

1. **Authentication is external to the ACP message flow.** Kimi must already be installed and logged in, or Adrian OS must explicitly implement and test the documented ACP authentication flow.
2. **ACP is stdio, not a public web endpoint.** A Windows Companion or other trusted local supervisor must own the child process and relay only authenticated, bounded events.
3. **File and terminal permissions are reverse-RPC decisions.** Adrian OS cannot safely treat every Kimi file or terminal request as automatically allowed.
4. **Audio is not supported as an ACP prompt capability.** Adrian Speak must use a transcript/text bridge later.
5. **MCP transport support is selective.** HTTP, stdio, and SSE are documented; ACP-transport MCP servers are discarded by Kimi.
6. **The current Kimi docs require a sufficiently new runtime for the upstream monorepo.** The repository's own runtime currently uses Node 22.23.4 in the audit environment, while the upstream package metadata declares Node >=24.15.0. This is a Companion/runtime compatibility decision and must not be hidden inside the web app.
7. **The exact CLI pin is unresolved.** The documented release is v2.5.0, while the observed repository HEAD is a different moving target. Phase 1 must choose and record one exact tag/commit and verify its installed binary version.

## 3. Reuse map

The following existing areas should be reused rather than duplicated:

- **Identity:** `src/lib/auth/*`
- **Owner isolation and forbidden-environment guard:** `src/lib/mind/isolation.ts`, `src/lib/mind/guards*`, and existing server auth gates
- **Policy/approval/stop:** `src/lib/mind/policy.ts`, `src/lib/mind/execution-gate.ts`, `src/lib/mind/halt*`, `src/lib/mind/pc-pairing/approvals.ts`
- **Pairing/security boundary:** `src/lib/mind/pairing/*`, `src/lib/mind/pc-pairing/*`, `/api/mind/pairing/*`, `/api/mind/pc/*`
- **Agent/run/event persistence patterns:** `src/lib/mind/fleet.ts`, `src/lib/mind/agent-session.ts`, `migrations/0003_fleet.sql`
- **Provider status and configuration:** `src/lib/mind/provider-call.ts`, `src/lib/mind/providers.ts`, `src/lib/mind/ai-provider-config.server.ts`
- **MCP registry and connector handling:** `src/lib/mind/mcp/*`, `src/lib/mind/connected-mcp.server.ts`, `migrations/0005_custom_connection.sql`
- **Voice transcript path:** `src/lib/mind/voice/*`, after ACP text submission is stable
- **Current app shell:** `src/components/mind/command-app.tsx`, with a later focused Build-workspace extraction instead of an immediate whole-file rewrite

No duplicate authentication, provider router, MCP registry, pairing system, voice system, or approval system should be created.

## 4. Phase 0 risk register

### R1 — ACP version drift

**Severity:** High.  
The CLI docs and upstream source are moving. A guessed method name or stale capability table could break sessions or silently omit tool behavior.  
**Control:** Pin an exact CLI release/commit, record `kimi --version`, capture `initialize` capabilities, and contract-test every used method.

### R2 — Untrusted local execution boundary

**Severity:** Critical.  
Kimi can request file operations and terminal execution. A public server must not expose an unrestricted shell or filesystem endpoint.  
**Control:** Keep the Kimi process on the paired Windows Companion; enforce approved workspace roots, signed device/session binding, one-time human approvals for protected commands, cancellation, emergency stop, redaction, and audit events.

### R3 — Authentication/session ownership mismatch

**Severity:** High.  
Adrian OS owner identity and Kimi's local login state are separate authorities.  
**Control:** Bind each Build session to owner, device, workspace, Kimi session ID, and runtime version. Never infer Kimi authentication from an Adrian OS login alone.

### R4 — Existing file-backed pairing state is not cloud durability

**Severity:** High.  
`.data/` state and PGLite fallback do not prove durable multi-device recovery.  
**Control:** Phase 1 can use one approved runtime with explicit local-state limitations; Phase 7 must design durable persistence and recovery separately.

### R5 — False feature parity

**Severity:** High.  
Kimi exposes capabilities that Adrian OS does not yet expose or govern.  
**Control:** Maintain a capability inventory with evidence and display unavailable/limited states honestly.

### R6 — Runtime version mismatch

**Severity:** Medium/High.  
The upstream monorepo declares Node >=24.15.0 while the current Adrian checkout uses Node 22.23.4 in this environment.  
**Control:** Run Kimi as a separately managed Companion/runtime process with its own supported toolchain; do not upgrade the web app blindly during Phase 1.

### R7 — Event volume and persistence pressure

**Severity:** Medium.  
Live assistant chunks, tool events, terminal output, diffs, and audit records can overwhelm a browser or database.  
**Control:** Define bounded event sizes, redaction, backpressure, retention, and a summary-vs-raw event policy before implementing streaming.

### R8 — Concurrent agents and branch collisions

**Severity:** Medium.  
The blueprint allows specialized agents, but shared file editing can collide.  
**Control:** Phase 1 uses one session and one workspace. Later parallel work requires explicit ownership, branch/worktree rules, and merge validation.

### R9 — Existing baseline is not entirely clean

**Severity:** Medium.  
The dependency-backed audit found lint errors and six cancelled service-board tests.  
**Control:** Do not attribute these baseline issues to Kimi. Record them separately and avoid broad cleanup during Phase 1.

## 5. Exact Phase 1 modification candidates

This is the initial file-level scope to confirm before coding. It is a candidate list, not authorization to change all files:

### New modules likely required

- `src/lib/mind/kimi/` — typed ACP client/adapter, capability model, session lifecycle, event normalization, cancellation, and error mapping.
- `src/lib/mind/build/` — Build session/task/workspace types and server-side orchestration boundary, if these concepts are not cleanly housed under `kimi/`.
- `src/routes/api/mind/build/` — authenticated session/task/status/event endpoints or one streaming endpoint, chosen after the adapter contract is finalized.
- `agent/windows/` — Companion-side Kimi process supervision, only after verifying the existing Windows agent layout and installer contract.
- `docs/kimi/` — pinned version, installation prerequisites, supported capability matrix, and recovery notes.

### Existing modules likely to be integrated

- `src/components/mind/command-app.tsx` — replace only the guarded Build placeholder mount with a focused Build workspace component after the runtime slice works.
- `src/components/mind/pairing/pairing-card.tsx` and `src/lib/mind/pairing/status.ts` — show runtime/Kimi readiness without inventing Connected state.
- `src/lib/mind/pc-pairing/*` and `src/routes/api/mind/pc/*` — reuse the pairing/approval boundary or explicitly document why the Companion needs a narrower adapter.
- `src/lib/mind/halt*`, `src/lib/mind/policy.ts`, and `src/lib/mind/execution-gate.ts` — bind emergency stop and approvals to runtime/tool actions.
- `src/lib/mind/fleet.ts` and `src/lib/mind/agent-session.ts` — reuse or extend run/session event concepts only after deciding whether Build sessions need separate durable entities.
- `migrations/0003_fleet.sql` and possibly a new migration — only if the existing run/event model cannot represent Build session/task/runtime/workspace ownership without unsafe duplication.
- `src/lib/mind/mcp/*` — pass only supported, explicitly approved MCP configuration to `session/new`/`session/load`.
- `src/lib/mind/server.ts` and `src/lib/mind/turn.server.ts` — integrate status and text submission only where the existing server-function conventions are appropriate; do not route Kimi through the Grok chat path.

### Files that should not be changed in Phase 1 without a specific reason

- The general visual system and unrelated dashboard/voice polish.
- Existing provider selection semantics for normal chat.
- Forbidden Supabase project configuration.
- Production deployment configuration and live database migrations.
- The full `command-app.tsx` shell beyond a focused Build mount.

## 6. Validation baseline captured during Phase 0

The checkout initially lacked `node_modules`. `npm ci --ignore-scripts` was run using the committed lockfile. It installed 546 packages and reported 7 moderate npm audit vulnerabilities. No `npm audit fix` was run.

Passed after dependency installation:

- `python tools/bootstrap/validate_bootstrap.py`
- `python team/validate_manifest.py` — 14 agents, 16 callable tool declarations, 29 registry entries, 17 upstream source checkouts
- REA unit tests — 2 passed
- Security review unit tests — 3 passed
- Knowledge unit tests — 3 passed
- Team unit tests — 89 passed
- `npx tsc --noEmit`
- `npm run build` — completed; database migration skipped because `DATABASE_URL`/`POSTGRES_URL` is unset, and PGLite assets were copied

Baseline issues:

- `npm test` executed 1,332 tests: 1,326 passed, 0 assertion failures, and 6 tests were cancelled by a pending promise in `src/lib/mind/service-board-status.test.ts`; the command exited 1.
- `npm run lint` exited 1 with 13 errors and 92 warnings. Errors include `no-control-regex`, `prefer-const`, `no-this-alias`, `no-unused-expressions`, and `no-useless-escape` findings in existing files. No lint cleanup was performed.
- No live Kimi process, Kimi login, Windows Companion, provider call, external MCP call, or production deployment was performed.

## 7. Phase 1 handoff contract

The next agent may begin only after the owner presses Continue and accepts that Phase 1 is starting. The next agent should read this audit first and then:

1. Verify the Windows Companion source and installation contract in the current repository.
2. Choose and pin one Kimi Code CLI release/commit.
3. Confirm the installed `kimi --version` and supported Node/toolchain on the Companion.
4. Define the typed internal adapter contract around the actual ACP messages used.
5. Implement one authenticated session on one approved workspace.
6. Implement event normalization for assistant chunks, plans, tool-call lifecycle, permission requests, file operations, terminal operations, errors, cancellation, and completion.
7. Reuse existing owner, pairing, approval, halt, redaction, and audit controls.
8. Add contract tests with a deterministic fake ACP peer and a smoke test against the real Kimi process only when credentials and the paired machine are available.
9. Stop before the full Build UI, editor, terminal tabs, voice bridge, provider management, persistence redesign, or production deployment.

**Phase 1 success condition:** Adrian OS can start one real Kimi Code session through the approved runtime boundary, submit one task, receive live structured results, and close/cancel the session without mocks being presented as real execution.

## References

[1]: https://github.com/MoonshotAI/kimi-code "Official MoonshotAI Kimi Code CLI repository"
[2]: https://www.kimi.com/code/docs/en/kimi-code-cli/guides/ides.html "Kimi Code CLI IDE integration guide"
[3]: https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html "Kimi Code CLI ACP reference"
[4]: https://www.kimi.com/code/docs/en/kimi-code/whats-new.html "Kimi Code release notes"
