# Adrian Build — Kimi Code Complete Integration & Deployment Blueprint

**Status:** Implementation specification / not yet implemented  
**Target:** Existing Adrian OS Build destination and production website  
**Repository:** `emzylavish-art/adrians-mind-command-os`  
**Working branch:** `feature/adrian-build-kimi-integration`  
**Owner decision:** Website-first delivery. Windows PC execution is a later supported runtime option, not a prerequisite for the hosted website release.

---

## 0. Executive contract

Deliver one native Adrian-branded Build workspace inside the existing Adrian OS application. It must use the real Kimi Code engine and its real capabilities through a maintained adapter/runtime integration. It must not be a screenshot, visual clone, chat-only wrapper, external link, or iframe-only embed.

The first release must run on the website using a persistent hosted execution service. The user's Windows PC is not required to build, test, preview, or deploy the first website version. A later Windows Companion may be paired to Adrian OS to provide local-machine workspaces and local tools, with the same Adrian Build UI and policy model.

The finished experience should expose the relevant Kimi Code capabilities in Adrian's interface: coding agent, sessions, projects/workspaces, file editing and diffs, terminal, Git operations, task/event streaming, subagents, skills, plugins/marketplace, MCP integrations, hooks, provider/model configuration, supported attachments/media, and runtime/capability status. Each capability must be wired to a real supported operation. If a feature is unavailable in the selected upstream version or deployment target, show a truthful disabled/unsupported state with a reason; never display a fake working control.

Adrian OS remains the product host and security/control plane. Kimi is the coding runtime, not a second identity system or an independent product. Adrian owns user authentication, workspace authorization, project ownership, credential vaulting, policy/approvals, device pairing, audit events, quotas, usage visibility, and Adrian Speak. Kimi executes approved coding tasks behind that boundary.

### Non-negotiable delivery rules

1. Website-first: hosted persistent runtime is the initial target. Do not block on the user's PC.
2. PC-later: Windows Companion is a separately gated second runtime target using the same adapter contract.
3. Real engine: pin and run a real upstream Kimi Code release/commit. No fake agent or simulated tool output.
4. Native product: Build remains in the existing Adrian sidebar, route, visual system, authentication and persistence.
5. Full feature accounting: every Kimi capability is mapped to an Adrian surface, an adapter operation, policy, test and status.
6. One source of truth: Adrian owns users, workspaces, approvals and secrets; Kimi owns its execution internals and native session semantics. The adapter maps between them.
7. No secret exposure: credentials never enter browser bundles, URLs, client logs, source control or unredacted transcripts.
8. Fail closed: uncertain permissions, unsupported actions, missing runtime, invalid credentials or lost policy checks block execution.
9. No production side effects before gates: no production migration, secret mutation, paid service provisioning, merge or deployment without the required owner authorization and passing validation.
10. Evidence over labels: a registry entry, UI control, mock or health check does not count as a live integration.

---

## 1. Target architecture

### 1.1 Logical topology

```text
Browser / Adrian OS
  └── Existing Build sidebar destination (Adrian-branded UI)
      └── Adrian Build API / Control Plane
          ├── Adrian authentication + owner-scoped authorization
          ├── Workspace/project service + durable metadata
          ├── Policy engine + action approvals + emergency stop
          ├── Credential vault + provider routing
          ├── MCP / integration governance + connection registry
          ├── Audit / usage / quota / event persistence
          ├── Adrian Speak voice session bridge
          └── Kimi Runtime Gateway
              ├── Runtime scheduler / durable job queue
              ├── Persistent Kimi Code runtime service (hosted, Phase 1)
              │   ├── pinned Kimi Code engine
              │   ├── isolated workspace filesystem
              │   ├── process/terminal supervisor
              │   ├── Kimi REST API + WebSocket event stream
              │   └── per-runtime Kimi config and plugin/skill/MCP view
              └── Windows Companion adapter (later Phase 2)
                  ├── outbound authenticated device channel
                  ├── local project/workspace broker
                  ├── local process/terminal supervisor
                  └── same policy, audit and event contract
```

### 1.2 Website hosting requirement

The current Adrian web app is built with Vite/TanStack React Start and deployed to Vercel. Vercel/serverless request handlers must not be treated as the long-lived Kimi process host. The initial website release therefore requires a persistent container/VM/worker service (or an equivalent managed persistent runtime) reachable only through the Adrian server-side gateway.

The browser talks only to Adrian's same-origin API. The browser must never call Kimi runtime endpoints directly, receive Kimi bearer tokens, or know runtime host addresses. Adrian's server authenticates the user, authorizes the workspace/action, then forwards a bounded request to the assigned runtime.

The runtime service must be deployable independently from the web frontend. Use a private network where available; otherwise use TLS, short-lived service identity, signed requests, strict allowlists, request IDs, replay protection and rotated credentials. Do not expose a raw Kimi server port to the public internet.

### 1.3 Runtime deployment modes

| Mode | Purpose | Release status |
|---|---|---|
| Hosted persistent runtime | Website Build executes code in isolated hosted workspaces | Required for first release |
| Windows Companion runtime | Website Build can select a paired Windows machine and operate approved local projects | Later release |
| Local development runtime | Developer-only smoke tests and adapter development | Development only |
| Vercel function | Auth, routing, metadata, short control requests | Never host persistent Kimi process |

### 1.4 Runtime allocation model

- Allocate one isolated runtime/workspace container per active user workspace or execution lease. Do not share a writable filesystem or Kimi home directory between tenants.
- Use a scheduler to allocate, warm, suspend and retire runtime instances. Idle suspension is allowed only after session state and filesystem state are safely persisted.
- Runtime jobs must have owner ID, workspace ID, runtime ID, session ID, correlation ID, idempotency key, lease expiry and policy snapshot.
- A runtime lease must be revocable. Revocation cancels active tasks, blocks new commands and destroys/recycles the isolated execution environment according to retention policy.
- Never rely on in-memory process state as the only copy of a user-visible session or event history.
- Set hard CPU, memory, disk, process-count, network-egress, execution-time and concurrent-job limits. Prevent fork bombs, unbounded builds and uncontrolled background daemons.
- Network egress is deny-by-default; explicitly allow only required package registries, source hosts and configured MCP endpoints. Add SSRF protections and DNS/IP revalidation.

---

## 2. Upstream Kimi Code intake and compatibility contract

### 2.1 Source intake

The implementation agent must inspect the official upstream repository and docs at the start of Phase 0. Record:
- Exact upstream repository URL, release tag, commit SHA and release date.
- Exact license and all required notices for the pinned files/packages.
- Supported operating systems, CPU architectures, Node/Python/runtime requirements and install procedure.
- Kimi Code CLI, `kimi web`, ACP and any supported SDK/server surfaces.
- API schemas generated by the pinned runtime: `/openapi.json` and `/asyncapi.json`.
- Plugin, skill, agent/subagent, MCP, hooks, provider and configuration formats.
- Known security advisories, breaking changes, experimental API flags and upgrade/migration instructions.

Do not copy a mutable `main` branch into production. Pin a release/commit, create a reproducible build, record dependency hashes/SBOM and define an upgrade policy.

### 2.2 Preferred integration surface

Evaluate the official Kimi Code server API exposed by `kimi web` first. Current upstream documentation describes REST under `/api/v1` (plus versioned session/MCP surfaces) and a WebSocket event stream at `/api/v1/ws`. It also states that these APIs are experimental and may change. Therefore:
- The exact OpenAPI and AsyncAPI documents served by the pinned runtime are the source of truth.
- Generate or validate typed adapter contracts against those schemas.
- Store the schema snapshots and upstream version with the adapter.
- Add contract tests that fail when a runtime upgrade changes a required operation/event.
- Do not hard-code undocumented endpoints based on blog posts or a different Kimi release.
- Do not treat ACP as a substitute for the full Kimi feature surface; use it only where it materially helps editor/session integration.

### 2.3 Adapter boundary

Create a provider-neutral Adrian interface around Kimi. Suggested modules (names are illustrative; adapt to repository conventions after inspection):
- `src/lib/mind/kimi/contracts.ts` — Adrian-side typed request/event/status types.
- `src/lib/mind/kimi/adapter.server.ts` — Kimi REST/WS adapter; server-only.
- `src/lib/mind/kimi/runtime-gateway.server.ts` — runtime assignment, leases, authenticated forwarding.
- `src/lib/mind/kimi/policy-bridge.server.ts` — map Kimi actions to Adrian policy/approval checks.
- `src/lib/mind/kimi/event-bridge.server.ts` — normalize Kimi events into Adrian durable event stream.
- `src/lib/mind/kimi/config-bridge.server.ts` — translate approved Adrian provider/MCP/plugin settings.
- `src/lib/mind/kimi/schema/ ` — pinned OpenAPI/AsyncAPI snapshots and compatibility metadata.
- `src/lib/mind/kimi/*.test.ts` — adapter, policy, schema and adversarial tests.

Do not create these exact paths blindly: first inspect existing module conventions and merge with existing `mcp`, `providers`, `pc-pairing`, `voice`, `persistence` and `agent` abstractions.

### 2.4 Compatibility gate

The adapter must negotiate runtime version and capabilities at connection time. It must refuse an incompatible version, missing mandatory endpoint, unsupported protocol version or disabled required capability. It must not silently downgrade to a fake or partial implementation.

Persist for every runtime:
- Kimi version and commit.
- API schema digest.
- Engine/backend version.
- Capability map and experimental flags.
- Runtime image digest.
- Adapter compatibility result.
- Last health check and last successful real operation.

---

## 3. Full feature migration map

The Build workspace must preserve Kimi's useful feature organization while using Adrian's own labels, visual language and control model.

| Kimi capability | Adrian Build surface | Required real operation | Adrian control / evidence |
|---|---|---|---|
| Main coding agent | Build conversation/workbench | Create/resume Kimi session, submit prompt, stream result | owner/workspace authorization; real session E2E |
| Session management | Sessions sidebar/history | create, list, resume, rename/title, archive/fork/delete where supported | owner-scoped persistence and reconnect tests |
| Projects/workspaces | Projects picker | create/open/close project; bind runtime directory | path scope and tenant isolation tests |
| File explorer | Files panel | list/read/search files through runtime | path traversal/symlink tests |
| File editing | Editor + diff review | Kimi writes file, return patch/diff, save/restore | approval policy and patch integrity tests |
| Terminal | Terminal panel | run/cancel command, stream stdout/stderr/exit status | command policy, timeout, process cleanup |
| Git | Source control panel | status/diff/log/branch/commit/push/pull as supported | destructive action approvals; Git E2E |
| Subagents | Agent activity/delegation panel | list/delegate/monitor/collect child agent result | bounded depth/concurrency/budget |
| Skills | Skills library | discover, install, enable, activate, invoke | source trust, version and permission review |
| Plugins | Plugin manager/marketplace | browse, preview, install, enable, disable, update, remove | provenance, manifest scan, rollback |
| MCP | Integrations / MCP manager | discover, configure, auth, connect, list tools, call, restart, disable | Adrian connection registry and consent |
| Hooks | Automation/policy panel | inspect and manage lifecycle hook rules | allowlisted actions, hook audit and deny tests |
| Providers/models | Model & provider settings | list/configure/select provider/model, test connection | Adrian vault; never expose raw secrets |
| Context/config | Project settings | approved config read/write and effective config view | schema validation and change audit |
| Attachments/media | Composer attachment rail | upload supported image/video/files and pass references | type/size/scanning/retention controls |
| Web/browser capability | Tools/connected services | only when supported by pinned plugin/capability | explicit scope and domain allowlist |
| Computer use | Tools/capabilities | only if supported by target runtime and safely sandboxed | separate opt-in; human approval |
| Runtime status | Build status bar | health, version, lease, queue, resource state | telemetry and truthful states |
| Adrian Speak | voice control in Build | speech input/output bound to same active session | same session ID, barge-in/stop tests |
| Export/import | session/project menu | export supported transcript/project metadata | user ownership and redaction |
| Updates | Runtime management | controlled runtime image upgrade and rollback | staged canary and schema compatibility |

### 3.1 Capability status vocabulary

Use only these statuses: `VERIFIED`, `PARTIAL`, `UNSUPPORTED`, `BLOCKED`, `NOT_AUDITED`.

Every status row must contain:
- Feature and subfeature.
- Kimi upstream version.
- Adrian UI location.
- Adapter operation and upstream endpoint/protocol.
- Runtime target (hosted, Windows Companion, both).
- Permission/approval rule.
- Automated test ID.
- Manual acceptance evidence.
- Known limitation and next action.

A feature cannot be marked VERIFIED because it merely appears in the UI, exists in an upstream manifest, or passes a mocked test.

---

## 4. Adrian Build user experience

### 4.1 Navigation and shell

- Keep the existing Adrian OS sidebar and its Build destination. Do not add a duplicate top-level app, duplicate dashboard or second sign-in.
- Clicking Build opens the full coding workspace within Adrian OS, with responsive desktop/tablet/mobile layouts.
- Use Adrian's current typography, spacing, motion, colors, theme, command palette, toast/error patterns and navigation primitives.
- Retain useful Kimi feature groupings: workspace/project, sessions, agent activity, files, editor, terminal, source control, skills, plugins, integrations/MCP and settings.
- Add clear runtime selector/status: Hosted Runtime (default first release), and later Paired Windows PC when paired.
- Show the selected project, active session, runtime health, model/provider, task state, approvals pending and stop control.
- No external Kimi web UI iframe. If a native upstream panel is impossible, reproduce its user-facing workflow using Adrian components connected to real APIs.

### 4.2 Core layout

Desktop layout should support:
- Left rail: projects and sessions.
- Main area: conversation/agent task stream.
- Optional editor pane: tabs, file tree, diff view.
- Bottom/side panel: terminal, logs and Git changes.
- Right contextual panel: agent/subagent activity, tool calls, approvals and file changes.
- Top toolbar: runtime, project, model, session controls and health.
- Settings drawer/page: providers, plugins, skills, MCP, hooks, capabilities and workspace policy.

Panels should be resizable/collapsible with persisted per-user layout. Mobile should prioritize conversation, project/session switching, approvals and task stop; advanced panels can become tabs/drawers, but must remain reachable.

### 4.3 Interaction standards

- Prompt submission creates exactly one task/session action with an idempotency key.
- Stream real events; display queued/running/waiting-for-approval/completed/failed/canceled states distinctly.
- Tool calls are visible as activity records with input summary, target, approval state and result; redact secrets.
- File writes produce a reviewable diff before applying when policy requires approval.
- Terminal output is streamed with truncation and download limits; no HTML execution.
- Stop cancels the active Kimi operation and its child work; emergency stop blocks subsequent actions until owner re-enables it.
- Reconnect replays durable events from a cursor and must not re-execute a task.
- Every empty/error/unsupported state explains what is missing and the next safe action.

---

## 5. Identity, persistence and data model

### 5.1 Ownership rules

- Adrian user ID is the canonical identity.
- Each project/workspace belongs to one Adrian user or explicitly shared team with role-based permissions.
- Runtime, session, plugin install scope, skill scope, MCP connection, provider reference, approval and audit record all carry an owner/workspace boundary.
- Never trust client-supplied owner IDs. Resolve identity from the authenticated server session.
- Cross-user access must fail closed, including guessed IDs, event replay, export, file path, runtime IDs and connection IDs.

### 5.2 Durable entities

Reuse existing schema/tables where appropriate; do not duplicate existing concepts. Add only the missing data model after a schema audit. The logical records required are:
- `build_workspaces`: owner, project root/storage ref, runtime preference, policy profile, timestamps.
- `build_runtimes`: owner/workspace, target, version, image digest, status, lease, capability map, health timestamps.
- `build_sessions`: owner/workspace/runtime, Kimi session ID, title, status, metadata, timestamps.
- `build_tasks`: idempotency key, task/session/runtime refs, state, cancellation, budgets, timestamps.
- `build_events`: ordered event sequence, task/session refs, normalized type, redacted payload, cursor.
- `build_approvals`: requester, exact action, target/resource, diff/hash, reason, expiry, decision, approver.
- `build_connections`: MCP/provider/plugin references, owner, auth state, scopes, status and last health.
- `build_extensions`: plugin/skill source, pinned version/hash, scope, install state, manifest metadata.
- `build_audit`: immutable security-relevant actions and outcomes.
- `build_usage`: model/provider/runtime usage, limits, budget reservation and reconciliation.

All user-owned rows require database-level owner scoping/RLS or an equivalent verified server authorization layer. Add indexes for owner/workspace/session/time/cursor. Use transactions for linked task/event/approval state transitions. Migrations must be additive, reversible where possible, tested on a disposable database, and must preserve existing Adrian data.

### 5.3 Persistence and replay

- Persist task creation before dispatch.
- Persist normalized events with monotonic per-task sequence/cursor.
- On reconnect, return events after cursor, current task snapshot and terminal state.
- Event writes must be idempotent on runtime event ID plus task ID.
- If the runtime disconnects mid-task, mark the task `interrupted/reconciling`, inspect runtime state, then resume or mark failed; never blindly resubmit.
- Transcript retention, file retention, logs and export must follow owner-configurable documented retention policy.
- Never store raw credentials in event payloads or transcript text.

---

## 6. Authentication, security and governance

### 6.1 Authentication and service identity

- Use the existing Adrian authentication/session helpers and same-origin/CSRF protections.
- Every Build API route must require an authenticated user and verify workspace access.
- Runtime-to-gateway calls use separate service identity, mTLS or signed short-lived tokens, audience restrictions, timestamp/nonce, request ID and replay prevention.
- Kimi's bearer token remains inside the runtime/gateway secret boundary. It is never sent to the browser.
- Rotate runtime credentials and revoke them on runtime retirement, pairing revocation or incident response.

### 6.2 Approval model

Classify actions:
- **Read-only low risk:** list/read/search files within authorized workspace, inspect Git status, read task output. May run under workspace policy.
- **Bounded workspace writes:** create/edit files, apply patch, run approved test/build commands. Require configured policy and optionally per-action approval.
- **External side effects:** push/merge, deploy, publish, send messages, modify remote resources, install extensions/MCP servers, authorize OAuth, access secrets. Require explicit approval with exact target/scope.
- **High-risk/destructive:** delete workspace, recursive delete, privileged shell, arbitrary network, production migration, secret rotation, force push, permission escalation. Block by default; owner-only explicit action where allowed.

Approval must display exact command/action, project path, changed files/diff hash, external destination, data scope, estimated cost if known, and expiry. Approval is single-use, bound to exact action and target, and invalidated if the payload changes.

### 6.3 Sandbox and process controls

- Run Kimi as non-root/non-admin.
- Use isolated filesystem mounts; workspace is the only writable project mount by default.
- Block path traversal, symlink escape, device files, unsafe archive extraction and arbitrary host paths.
- Run terminal commands in a process supervisor with timeout, process group cleanup, output cap, CPU/memory/disk limits and explicit environment allowlist.
- Do not mount Docker socket, cloud metadata endpoints, host credentials or privileged devices into the runtime.
- Disable privileged container mode.
- Use read-only root filesystem where possible; ephemeral temp and cache mounts.
- Restrict outbound network and DNS; defend against SSRF, loopback/private-IP pivoting and malicious redirects.
- Scan uploaded files and plugin bundles; limit size/type and reject executable uploads where unsupported.
- Treat project files, plugin manifests, MCP tool output, web content and model output as untrusted data, never as instructions to bypass policy.

### 6.4 Plugin and skill supply chain

- Preview plugin metadata before install.
- Pin plugin source to immutable commit/release and content hash.
- Inspect manifest and declared permissions, MCP servers, hooks, commands, agent files and network destinations.
- Require explicit user confirmation before enabling executable hooks, stdio MCP servers or commands.
- Run plugin-provided code only inside the runtime sandbox with scoped credentials.
- Provide disable, uninstall, rollback and audit.
- Keep official/curated/custom source labels and trust metadata.
- Do not auto-install every Kimi marketplace item.
- Skills are instruction content, not authority grants; a skill cannot alter Adrian policy or approval requirements.
- Revalidate plugin/skill hashes before runtime activation.

### 6.5 Audit and emergency controls

Audit: login/session access, runtime create/stop, project mount, prompt dispatch, tool calls, file edits, terminal commands, approval request/decision, provider use, MCP connect/call, plugin/skill changes, secret access metadata (never secret value), export/delete, pairing/revocation and policy changes.

Emergency stop:
- Per task stop.
- Per workspace stop.
- Global Adrian Build stop.
- Revoke runtime lease and cancel active child processes.
- Deny new dispatch until explicit owner resume.
- Persist stop state in durable storage; do not rely on serverless local disk.
- Test stop under streaming, child-agent, terminal and network disconnect scenarios.

---

## 7. Providers, credentials, integrations and MCP

### 7.1 Providers and models

- Reuse Adrian's existing provider registry, encrypted credential storage, provider routing and budget preflight.
- The Build UI lists supported providers/models based on verified runtime compatibility, not hardcoded assumptions.
- Translate Adrian provider references to Kimi provider config server-side.
- Keep provider secrets in Adrian vault or a dedicated secret manager; inject only the minimum required secret into the isolated runtime at task start.
- Never persist secrets in Kimi project files, `config.toml` committed to Git, environment dumps, terminal history, browser state or logs.
- Test provider auth, model discovery, streaming, tool calling, cancellation, timeout and budget accounting for each provider.
- If the current runtime requires a credential format that cannot be safely bridged, mark that provider unsupported for hosted Build until resolved; do not silently use a different provider.

### 7.2 MCP and integrations

Adrian's existing MCP system is the governance source of truth. Kimi must receive a scoped runtime view of approved MCP servers, not an independent uncontrolled registry.

- Map Adrian connection ID to Kimi MCP server ID.
- Support supported transports (stdio, HTTP/SSE or current upstream-supported protocols) only after contract verification.
- OAuth authorization is completed through the Adrian connector flow where possible; tokens are encrypted and scoped.
- For stdio MCP, execute only allowlisted commands inside the sandbox. Never allow arbitrary host command paths.
- Validate server URL, DNS, IP range, redirect target and TLS certificate; prevent SSRF.
- List tools and schemas; expose only approved tools to the session.
- Record every MCP call, arguments summary, approval decision and result with redaction.
- Provide connect, disconnect, reconnect, restart, enable, disable, scope review and revoke.
- On disconnect/revoke, active sessions receive a clear failure and cannot keep using cached credentials.

### 7.3 Existing integration catalog

Audit `tools/integrations/catalog.json`, `tools/registry.json`, `.gitmodules`, existing MCP registry and connector implementations. Distinguish:
- Source pinned only.
- Catalog-only.
- Adapter implemented.
- Configured.
- Authenticated.
- Live verified.
- Unsupported/blocked.

Only real, tested adapters are offered as connected capabilities. Existing integrations must not be duplicated just to satisfy Kimi's interface.

---

## 8. Skills, agents, subagents and hooks

### 8.1 Skills

- Build a discoverable Skills Library with built-in, workspace, user and plugin-provided scopes where upstream supports them.
- Display name, description, source, version/hash, scope, required tools and when-to-use metadata.
- Install/import from supported sources after trust review.
- Activate a skill in a session using the pinned runtime's supported API/command.
- Keep skill content in versioned storage and sync it to runtime only when authorized.
- Skills may guide workflow but cannot grant tools, bypass approval or override system policy.
- Test discovery, install, activation, invocation, update, disable and removal.

### 8.2 Agents and subagents

- Surface built-in and plugin-provided agents/subagents discovered from the pinned Kimi runtime.
- Show role, model/provider, allowed tools, workspace scope, status, parent task and result.
- Enforce maximum nesting depth, concurrency, per-task token/time budget and shared cancellation.
- Child agents inherit or receive a narrower permission set; never a broader one.
- Parent agent cannot approve its own elevated action.
- Preserve trace links from parent to child runs and audit all delegation.
- Verify actual delegate/return-result behavior with a real Kimi session, not a mocked subagent list.

### 8.3 Hooks

- Discover supported lifecycle events and hook schema from the pinned version.
- Provide a hook manager with source, event, executable/action, scope, enabled state and last result.
- Hooks run in the sandbox with explicit timeout and allowlisted actions.
- Pre-tool/pre-command hooks can deny actions but cannot weaken Adrian policy.
- Hook failures default to deny for security-sensitive events; non-security notification hooks may fail open only by explicit policy.
- Add tests for each event, timeout, malicious hook, deny result, disable and audit.

---

## 9. Adrian Speak integration

Adrian Speak must control the same Build session rather than launch a separate unrelated assistant.

- Voice session carries the active Adrian user, workspace, Kimi session and task IDs.
- Speech-to-text submits a normal Build prompt through the same policy and idempotency path.
- Text-to-speech reads only approved/redacted response content.
- Barge-in/stop cancels the active generation and any permitted child work.
- Tool execution requiring approval pauses voice execution and presents a visual approval card; spoken “yes” alone must not approve high-risk operations unless a separately designed secure voice confirmation is implemented.
- Maintain transcript synchronization, partial transcript handling, audio attachment limits and reconnect behavior.
- Test microphone/speaker on supported browsers/devices separately from unit mocks.
- If voice provider is unavailable, Build remains usable by text.

---

## 10. Windows Companion — later phase, same product

Windows Companion is a second runtime target, not the first website release dependency.

- Deliver as a signed, updateable Windows service/tray application or documented companion process, selected after threat-model review.
- Pair through Adrian's existing PC pairing flow with one-time short-lived code, device identity, explicit owner confirmation and revocation.
- Companion establishes outbound TLS connection to Adrian gateway; do not require inbound router ports or public exposure of the PC.
- Store device credentials in Windows Credential Manager/DPAPI; rotate and revoke.
- Expose only declared capabilities: approved workspace roots, file operations, terminal supervisor, Git and selected local integrations.
- Use path allowlists chosen by the owner; default to a dedicated workspace folder, not the whole drive.
- Require approval for shell, destructive file operations, installs and external side effects.
- Run as standard user; no automatic administrator escalation. If a target application requires elevation, stop and request explicit separate handling.
- Companion heartbeat, health, runtime version, last seen, active task, queued task and revoke status appear in Adrian Build.
- Handle sleep, network changes, reconnect, expired pairing, app upgrade and interrupted tasks without duplicate execution.
- The same Adrian Build UI switches between Hosted Runtime and Paired Windows PC. Session history remains owner-visible across targets, while files stay on the selected runtime unless explicitly synchronized.
- Windows Computer Use, if offered, requires a visible opt-in and warns that it may control the physical mouse/keyboard; do not imply invisible background control.

---

## 11. Delivery phases and exit gates

### Phase 0 — Source-of-truth audit and scope freeze

**Work**
1. Read current `AGENTS.md`, `ENGINEERING.md`, README, Notion handoff and current project-state record.
2. Refresh `main`, the feature branch and PR base/head; reconcile against latest source before editing.
3. Trace Build navigation in `src/components/mind/command-app.tsx`, route registry and tests.
4. Inventory auth, workspace/project, database, provider, MCP, pairing, approval, audit, event streaming, emergency stop and voice modules.
5. Inspect Kimi official source, license, release, server API schemas, plugin/skill/agent/MCP/hook/provider contracts.
6. Inspect Vercel deployment topology and determine which persistent runtime hosting options are already available/approved.
7. Produce architecture decision record, dependency/license report, file ownership plan, feature matrix and baseline test report.

**Exit gate**
- No unknown Build route ownership.
- Exact Kimi release candidate and license recorded.
- Hosted runtime hosting strategy identified and cost/security review completed.
- Every feature has an implementation owner and verification plan.
- Existing database and integrations inventory reconciled.
- No production secrets or forbidden Supabase projects touched.

### Phase 1 — Runtime foundation and hosted Kimi proof

**Work**
1. Build a reproducible, pinned Kimi runtime image/container.
2. Run the Kimi server in a persistent isolated hosted environment, loopback-bound inside its container/network namespace.
3. Verify authenticated health, metadata, OpenAPI and AsyncAPI from the exact image.
4. Implement Adrian runtime gateway and service authentication.
5. Create a runtime lease and bind one isolated workspace.
6. Create a real Kimi session, submit a simple prompt, stream events, retrieve history and cancel a task.
7. Restart the runtime and prove session/event recovery or explicit interrupted state.
8. Capture logs with secret redaction and correlate every request/task/session.

**Exit gate**
- Real hosted Kimi runtime is reachable only through Adrian gateway.
- One real session works end-to-end from a test harness.
- Event stream reconnects without duplicate task dispatch.
- Version/schema mismatch fails closed.
- Tenant filesystem and API isolation tests pass.
- No Windows PC dependency.

### Phase 2 — Adrian Build native shell and core vertical slice

**Work**
1. Wire existing Build sidebar to the native Adrian Build workspace.
2. Add project/session selector and hosted runtime status.
3. Add prompt composer and real streaming task view.
4. Add stop/cancel and durable session history.
5. Add file explorer, read-only file preview and diff display.
6. Add terminal panel with bounded harmless command execution.
7. Add task event timeline and error/unsupported states.
8. Persist layout and session/project state using existing Adrian data patterns.

**Exit gate**
- Signed-in user opens Build on the website.
- User creates/selects an authorized hosted project.
- Real Kimi session responds and streams.
- A file edit creates a reviewable diff.
- A harmless command runs in the isolated runtime and streams output.
- Stop works; refresh/reconnect does not duplicate execution.
- Mobile and desktop basic flows pass.

### Phase 3 — Filesystem, editor, Git and project lifecycle

**Work**
1. Complete safe file read/write/search and project navigation.
2. Add editor tabs, save state, syntax display and diff/patch review.
3. Add Git status, diff, log and branch operations.
4. Gate commit, push, pull, reset, checkout and destructive Git operations according to policy.
5. Add project creation/import/archive/delete with ownership and retention.
6. Add workspace quotas, backups/snapshots and restore procedure.

**Exit gate**
- File/path adversarial tests pass.
- Changes are attributable and reviewable.
- Git destructive actions require approval.
- Workspace restore test passes.
- No cross-tenant file access.

### Phase 4 — Skills, subagents, plugins, hooks and MCP

**Work**
1. Implement runtime capability discovery.
2. Implement Skills Library and activation.
3. Implement subagent discovery/delegation/monitoring with bounded budgets.
4. Implement plugin marketplace browse, preview, install, enable, disable, update, remove and rollback.
5. Implement MCP manager through Adrian's existing connector registry and OAuth.
6. Implement hook discovery/management with sandbox and fail-closed security rules.
7. Add supply-chain provenance, manifest scanning and plugin hash pinning.
8. Provide clear scope, source and permission information for each extension.

**Exit gate**
- Real skill activation and invocation test passes.
- Real subagent delegation returns a result and cancellation propagates.
- A safe test plugin installs, enables and can be removed/rolled back.
- A test MCP server connects, exposes an approved tool, calls it, disconnects and revokes.
- Hook deny/timeout tests pass.
- No plugin/MCP command can escape sandbox or bypass Adrian approval.

### Phase 5 — Providers, credentials, usage, quotas and Adrian Speak

**Work**
1. Bridge existing provider registry/vault to Kimi runtime.
2. Support each provider only after provider-specific auth/stream/tool-call test.
3. Add model selection, capability labels, connection test and usage view.
4. Implement budget reservation, quota checks, cancellation reconciliation and rate limits.
5. Connect Adrian Speak to the active Build session.
6. Add voice barge-in, transcript synchronization and approval handoff.
7. Add attachment handling and supported media types with scanning and size controls.

**Exit gate**
- No browser-visible provider secret.
- Provider requests use the intended provider; no silent fallback.
- Usage and cancellation accounting reconcile.
- Voice uses the same Kimi session and obeys the same policy.
- Unsupported media/provider paths are explicit.

### Phase 6 — Security hardening, resilience and production readiness

**Work**
1. Complete threat model and security review.
2. Test cross-user/workspace access, token theft, replay, CSRF, SSRF, DNS rebinding, path traversal, symlink escape, command injection, plugin abuse and log leakage.
3. Test runtime crashes, host restart, network partition, expired lease, duplicate event, queue backlog and cancellation race.
4. Test resource caps, concurrency limits, noisy-neighbor isolation and network egress policy.
5. Add monitoring, alerting, health dashboards, structured redacted logs and incident runbook.
6. Document backups, restore, runtime image rollback, Kimi version rollback and schema compatibility.
7. Verify privacy, data retention, export and deletion.
8. Complete dependency/SBOM/license review.

**Exit gate**
- All critical/high findings fixed or explicitly blocked from release.
- Security suite passes.
- Runtime recovery and rollback rehearsed.
- Monitoring and runbooks exist.
- No known unbounded execution path.
- Production data migration rehearsal passes on a disposable clone.

### Phase 7 — Preview, acceptance and website production deployment

**Work**
1. Rebase/reconcile implementation branch against current integration target using repository merge-gate process.
2. Run all repo standard checks and focused Build/Kimi test suites.
3. Deploy frontend and hosted runtime to preview/staging, not production.
4. Execute end-to-end acceptance from a real signed-in browser account against hosted runtime.
5. Verify Build sidebar route, real agent session, file diff, terminal, Git, skills, plugin, MCP, provider, approval, audit, stop, Adrian Speak, mobile layout and restart recovery.
6. Confirm exact frontend commit, runtime image digest, DB migration version and API schema digest.
7. Review costs, capacity, limits, backups, incident response and rollback.
8. Obtain owner approval for production release and any paid infrastructure/provider/secret changes.
9. Deploy through the existing Adrian OS Vercel project and the approved persistent runtime service. Do not create a second Adrian OS website/project.
10. Run production smoke tests and verify exact deployed SHA and runtime image. Keep rollback ready.

**Exit gate**
- Preview acceptance checklist 100% complete or explicitly documented non-blocking exclusions.
- CI green on exact release SHA.
- No production secrets in source.
- Migrations validated and backed up.
- Owner approval recorded.
- Production smoke tests pass; otherwise rollback.

### Phase 8 — Windows Companion rollout

**Work**
1. Implement Companion against the same runtime adapter contract.
2. Sign installer and update channel.
3. Pair device through Adrian PC pairing.
4. Select allowlisted workspace folders.
5. Verify local file operations, terminal, Git and task streaming.
6. Test device sleep, disconnect/reconnect, revocation and update.
7. Test policy parity with hosted runtime.
8. Add runtime selector in Build and clearly label where project files physically live.

**Exit gate**
- Signed installer provenance verified.
- Pairing and revocation tests pass.
- Device cannot access paths outside explicit roots.
- Outbound-only connection and token rotation verified.
- Same UI/policy/audit model works on both targets.
- Hosted website remains fully functional when no PC is paired.

### Phase 9 — Operational ownership and ongoing upgrades

**Work**
- Maintain Kimi release pin and upgrade calendar.
- Run compatibility suite against candidate upstream versions before upgrades.
- Keep a changelog of API/schema/plugin format changes.
- Canary new runtime images, then promote or rollback.
- Monitor runtime capacity, cost, queue latency, error rates and provider spend.
- Review plugin/MCP trust sources and revoke compromised packages.
- Periodically test backups, restore, incident response and emergency stop.
- Keep feature matrix current; never silently downgrade verified status.

**Exit gate**
- Named operational owner and documented on-call/incident process.
- Upgrade/rollback automation tested.
- Monthly security and cost review scheduled.
- Feature matrix and runtime inventory reflect deployed reality.

---

## 12. Test and acceptance catalogue

### 12.1 Automated tests

**Adapter/contract**
- OpenAPI/AsyncAPI schema compatibility.
- Version negotiation and incompatible-runtime rejection.
- REST auth, WS auth, event decoding and malformed frame handling.
- Idempotency, retries, cursor replay and duplicate event suppression.
- Rate limit, timeout and cancellation behavior.

**Identity/data**
- Unauthenticated request denied.
- User A cannot read/write User B workspace, session, task, event, runtime, approval, file or connection.
- Guessed IDs and replayed cursors do not leak data.
- RLS/owner checks and transactional state changes.
- Delete/export/retention policy.

**Execution**
- Path traversal, symlink escape, unsafe archive, shell injection and environment leakage.
- Process timeout, output cap, resource exhaustion and process-tree kill.
- Network egress/SSRF/private-IP/DNS-rebinding.
- Runtime crash and task reconciliation.
- Stop during tool call, subagent, terminal and stream.

**Extensions**
- Plugin manifest validation, hash pinning and rollback.
- Malicious hook denied.
- Unapproved MCP command/URL blocked.
- MCP OAuth expiry/revoke and tool-call audit.
- Skill prompt cannot elevate authority.
- Subagent cannot exceed parent permissions/budget.

**UI**
- Build navigation and responsive layouts.
- Session/project selection and restore.
- Streaming/reconnect without duplicate tasks.
- Diff review and approval.
- Terminal state/output.
- Errors, empty, unsupported and offline states.
- Keyboard accessibility and screen reader labels.

### 12.2 Real acceptance tests (not mocks)

1. Sign in to Adrian OS and open Build.
2. Create/select a hosted workspace.
3. Start a real Kimi session and send a coding prompt.
4. Confirm real response and tool events appear in the UI.
5. Ask Kimi to edit a disposable test file; inspect diff; approve/apply.
6. Run a harmless test command and see real output/exit code.
7. Stop a running task and prove child processes stop.
8. Refresh browser, reconnect and verify same task/session without duplicate execution.
9. Install a safe test plugin; verify declared skills/agents/MCP/hooks; disable and remove it.
10. Activate and invoke a skill in a real session.
11. Connect a controlled test MCP server and invoke one approved tool.
12. Delegate a bounded subtask and verify result/cancellation.
13. Test a configured provider and confirm no silent provider substitution.
14. Test Adrian Speak on supported browser hardware and verify same session ID.
15. Inspect audit records for task, file edit, terminal, approval and extension changes.
16. Restart runtime and verify session recovery or clear interrupted status.
17. Verify second test user cannot access first user's workspace or runtime.
18. Verify no paired PC is needed for the hosted website path.
19. Later, pair Windows Companion and repeat local workspace tests.
20. Revoke the Companion and verify it immediately loses access.

### 12.3 Evidence format

For each test record:
- Test ID and date.
- Adrian app commit SHA.
- Kimi release/commit and runtime image digest.
- OpenAPI/AsyncAPI schema digest.
- Runtime target and environment.
- Exact command or manual steps.
- Expected and actual result.
- Pass/fail/blocked status.
- Redacted logs/screenshot/trace reference.
- Owner and remediation ticket for failures.

---

## 13. Deployment, secrets, cost and rollback

### 13.1 Environment separation

Maintain separate dev, preview/staging and production:
- Separate runtime pools and data stores.
- Separate provider credentials and OAuth apps where possible.
- Separate signing keys/service identities.
- No production data copied to developer environments without approved sanitization.
- Production runtime cannot be reached from preview credentials.

### 13.2 Required configuration (names illustrative; align with repository conventions)

- `KIMI_RUNTIME_BASE_URL` — private gateway-to-runtime URL only.
- `KIMI_RUNTIME_SERVICE_TOKEN` or workload identity — server-side only.
- `KIMI_RUNTIME_IMAGE_DIGEST` — immutable image reference.
- `KIMI_UPSTREAM_VERSION` and `KIMI_API_SCHEMA_SHA256`.
- Runtime resource/timeout/concurrency/network policy settings.
- Adrian secret-manager references for provider and MCP credentials.

Never commit values. Never expose server-only variables with a public prefix. Validate configuration at startup and refuse production boot when required security settings are missing.

### 13.3 Cost controls

Before dispatch, reserve budget for model and runtime execution. Enforce per-user/workspace limits, max task duration, token budget where available, concurrency and idle runtime shutdown. Display estimated/actual usage with clear uncertainty where upstream usage data is unavailable. Reconcile charges after cancellation; cancellation does not guarantee upstream provider billing stops instantly.

### 13.4 Rollback

- Keep previous known-good frontend release and runtime image.
- Runtime schema migrations must be backward compatible across the rollout window.
- If Kimi upgrade breaks adapter contract, stop promotion and revert image pin.
- If frontend release fails, restore previous Vercel deployment/alias using the existing project process.
- If runtime security incident occurs, revoke service identity, stop leases, isolate affected workspaces and preserve redacted forensic logs.
- Data migrations require backup and restore rehearsal before production.
- Do not roll back by deleting user workspaces or silently resetting Kimi home/session data.

---

## 14. Required deliverables

The implementation is not complete until the branch/PR contains:
1. This master blueprint updated with final implementation decisions.
2. Architecture decision records for runtime host, Kimi adapter protocol, persistence, credential bridge and Windows Companion.
3. Pinned upstream source/release and license/notice inventory.
4. Reproducible runtime image/container build and deployment manifests.
5. Kimi API schema snapshots and compatibility tests.
6. Adrian Build native UI integrated into existing sidebar.
7. Runtime gateway, adapter, scheduler/lease and event bridge.
8. Database migrations and owner isolation tests.
9. Project/session/file/editor/terminal/Git functionality.
10. Skills, subagents, plugins, MCP and hooks management.
11. Provider/model/credential integration.
12. Adrian Speak integration.
13. Security policies, approval UX, audit, emergency stop and threat model.
14. Observability, quotas, cost controls and incident runbooks.
15. Automated unit/integration/security/E2E test suites.
16. Updated feature matrix with evidence links and honest status.
17. Preview deployment evidence and exact SHAs/image digests.
18. Production deployment/rollback evidence after owner approval.
19. Windows Companion plan and implementation evidence in its later phase.
20. Operator documentation: install, configure, upgrade, backup, restore, revoke, troubleshoot and recover.

---

## 15. File ownership and implementation workflow

The coding agent must:
1. Work only on the designated feature branch and never commit directly to `main`.
2. Read all repository instructions and current Notion handoff before substantial edits.
3. Refresh current branch/main/PR state; prior SHAs are historical, not authority.
4. Inspect actual source before choosing paths or replacing components.
5. Produce a Phase 0 audit before broad implementation.
6. Use small coherent commits with tests.
7. Avoid multiple agents editing the same files concurrently; assign disjoint modules and a single integrator.
8. Ask the owner only for decisions that cannot be inferred safely, such as paid hosting/provider approval, production secret changes, production migration/deploy approval, and data retention policy.
9. Keep a task ledger with status, owner, dependencies, evidence, blockers and next action.
10. Update this blueprint and feature matrix as implementation facts change.

### Suggested workstreams

- **A — Runtime & platform:** pinned image, runtime scheduler, gateway, adapter, event stream, health and recovery.
- **B — Adrian UI:** Build route, shell, projects, sessions, editor, terminal, Git and responsive design.
- **C — Capabilities:** skills, subagents, plugins, MCP, hooks and provider bridge.
- **D — Security/data:** auth, persistence, approvals, secrets, audit, quotas, sandbox and threat model.
- **E — Voice & device:** Adrian Speak now; Windows Companion in Phase 8.
- **F — Integration/QA:** merge reconciliation, test matrix, preview, deployment, rollback and evidence.

A single integration owner reconciles interfaces and merges workstreams. No parallel workstream may independently change shared contracts without coordination.

---

## 16. Known constraints and explicit non-claims

- Kimi's REST/WebSocket server API is documented as experimental; pin the exact version and use its served schemas.
- The first website release requires a persistent hosted runtime outside ordinary Vercel serverless execution.
- A Windows PC is not needed for the first hosted release; it is needed only for later local-machine execution and Windows-specific acceptance.
- A UI mock, upstream plugin listing, catalog entry, passing fake test or successful health endpoint does not prove a capability works.
- The exact license must be confirmed from the pinned upstream revision before packaging/distribution; preserve all notices.
- Hosting vendor, persistent compute budget, provider credentials and production environment access must be owner-approved; do not invent or assume these are provisioned.
- Existing repository notes indicate some current Adrian capabilities are catalog-only or partially implemented. Audit current code and deployment evidence before reusing or claiming them.
- The current PR #52 is a documentation/handoff PR, not an implementation PR. Do not describe Kimi integration as complete until the acceptance gates above pass.

---

## 17. Definition of done

Adrian Build is complete when a user can sign into the existing Adrian OS website, click the existing Build destination, select a hosted workspace, and use a real pinned Kimi Code runtime through a polished Adrian-branded coding workspace—with real sessions, coding actions, file diffs, terminal output, Git, skills, agents/subagents, plugins, MCP integrations, hooks, supported providers, approvals, audit, stop/cancel, durable reconnect and Adrian Speak—without requiring the user's PC.

The later Windows Companion must add local execution as another selectable runtime without replacing the hosted experience, duplicating the product, bypassing Adrian's security controls or changing the user's Build workflow.

**No phase is complete by declaration. Each phase closes only when its exit gate is demonstrated with recorded evidence.**
