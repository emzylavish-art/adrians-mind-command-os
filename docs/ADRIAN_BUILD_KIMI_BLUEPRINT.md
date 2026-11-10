# Adrian Build — Kimi Code Integration Blueprint

**Status:** Architecture and implementation handoff; not implemented or runtime-verified.
**Repository:** `emzylavish-art/adrians-mind-command-os`
**Implementation branch:** `feature/adrian-build-kimi-integration`
**Baseline main SHA at branch creation:** `a606c2c641bf311d3bf094d8739b3fbba2bdd1dd`
**Upstream:** https://github.com/MoonshotAI/kimi-code

## 1. Product outcome

Clicking **Build** in the existing Adrian OS sidebar must open a complete Adrian-branded coding workspace inside Adrian OS. The workspace is backed by the actual Kimi Code runtime. It is not a link, iframe-only wrapper, standalone Kimi app, or generic coding chatbot.

The user must be able to work on real projects, inspect and edit files, run terminal commands, use Kimi's supported agents/subagents, plugins, skills, MCP and hooks, manage sessions, select compatible model providers, and use Adrian Speak with the same coding session.

Preserve Adrian OS. Extend existing navigation, authentication, provider routing, MCP, voice, PC pairing, database and audit conventions. Do not replace these systems with parallel implementations.

## 2. Verified repository baseline

At branch creation the GitHub default branch `main` pointed to `a606c2c641bf311d3bf094d8739b3fbba2bdd1dd`. Repository access confirmed it is private and the connected GitHub identity has push/admin permissions.

Inspected:
- `AGENTS.md`: repository execution contract, owner-scoped security, evidence-based readiness, branch/production discipline and validation commands.
- `ENGINEERING.md`: current React/TypeScript/Vite/TanStack application, existing auth/provider/voice/MCP/PC-pairing and data architecture, and previously recorded deployment/test caveats.
- `README.md`: repository-native team runner, MCP and provider adapters.
- `package.json`: React 19, TypeScript, Vite 8, TanStack React Start, PGlite, MCP SDK and existing test scripts.
- `vercel.json`: hosted frontend/build configuration and security headers.
- `src/routes`: route tree inspected; no standalone `build.tsx` route was present in the listing. The existing Build experience may be routed from the large `src/components/mind/command-app.tsx`; implementation agent must trace the actual current sidebar/action wiring before changing it.
- `src/components/mind/command-app.tsx`: large existing command application; do not rewrite wholesale.
- `src/lib/mind/server.ts`: existing voice server path found.
- `.gitmodules`: many upstream projects already pinned; Kimi Code is not currently listed.

The repository's own rules prohibit secrets in source, touching the two forbidden Supabase projects (`ybxowvzicirinpdcfyqe` and `espmxiitzucooxblmnpr`), claiming a registry entry is a live integration, or changing production/deploying consequential changes without owner authorization and successful validation.

**Freshness warning:** Notion's Oct/Nov handoff contains a deployment checkpoint with conflicting historical statements. Its most recent correction says the production alias and current-main deployment were not aligned and that a Vercel TLS migration failure needed diagnosis. Re-check current GitHub HEAD, CI and Vercel deployment state before any release. Do not infer production status from older handoff text.

## 3. Upstream facts and source policy

The official Kimi Code repository currently documents a terminal coding agent that reads/edits files, runs shell commands, searches files and supports:
- video input;
- MCP configuration;
- plugins/marketplace;
- skills and data sources;
- built-in coder, explore and plan subagents;
- lifecycle hooks;
- ACP integration for compatible IDEs;
- compatible model providers.

The upstream repository declares the MIT License. Preserve its LICENSE, copyright and attribution notices, plus notices for transitive components. Adrian branding may be applied to the product shell; do not imply Moonshot trademarks or upstream ownership belong to Adrian.

Official source and docs:
- https://github.com/MoonshotAI/kimi-code
- https://moonshotai.github.io/kimi-code/en/
- https://moonshotai.github.io/kimi-code/en/configuration/providers.html
- https://www.npmjs.com/package/@moonshot-ai/kimi-code

Do not pin a version by guessing from an old chat. During Phase 0 inspect the current upstream main/release tags, package version, changelog, runtime interfaces, Windows support and exact licence. Record an immutable commit SHA and package version in the repo before integration. Prefer a pinned Git submodule or a controlled fork with Adrian patches isolated from upstream changes.

## 4. Architecture

### Hosted control plane (Adrian OS)
- Existing login/session and owner authorization.
- Build route and Adrian-branded workspace UI.
- Build gateway: validates owner, paired device, project scope, session scope and action policy.
- Durable session metadata, event cursor, approvals and audit.
- Existing Adrian provider router; never expose secrets to browser code.
- Existing Adrian Speak and agent context bridge.

### Execution plane (initially Windows)
- Paired Windows Companion, installed and supervised independently from the browser.
- Kimi Code runtime running as a persistent process.
- Workspace filesystem, shell, Git and developer tools on the Windows machine.
- Secure outbound authenticated connection to Adrian gateway; no public unauthenticated terminal or open inbound shell port.
- Runtime health, process supervision, reconnect and explicit disconnected/interrupted states.

### Future cloud execution
A separately deployed persistent worker/container/VM can be added for cloud projects. Do not run persistent terminal processes or assume durable workspace files inside ordinary Vercel serverless requests.

### Protocol decision
Inspect current upstream source first. Prefer the official supported runtime/API that provides the widest tested feature coverage. ACP is a useful adapter for editor/agent protocol interoperability but does not by itself provide the entire Adrian Build UI. Do not assume an undocumented REST/WebSocket API or invent Kimi endpoints. If the current Kimi version offers a documented web/server API, assess it against the full capability matrix. Build a translation adapter and contract tests around the exact API/schema version.

## 5. Runtime adapter contract

Adrian code should depend on a small internal interface, not scatter Kimi protocol details across React components:

```ts
interface BuildRuntime {
  health(): Promise<RuntimeHealth>;
  getCapabilities(): Promise<RuntimeCapabilities>;
  listProjects(): Promise<Project[]>;
  openProject(projectRef: string): Promise<Project>;
  createSession(projectId: string): Promise<BuildSession>;
  resumeSession(sessionId: string): Promise<BuildSession>;
  sendMessage(sessionId: string, message: BuildMessage): Promise<void>;
  subscribe(sessionId: string, cursor?: string): AsyncIterable<BuildEvent>;
  stop(sessionId: string): Promise<void>;
  listFiles(projectId: string, path?: string): Promise<FileEntry[]>;
  readFile(projectId: string, path: string): Promise<FileContent>;
  writeFile(projectId: string, path: string, content: string): Promise<void>;
  runTerminal(projectId: string, request: TerminalRequest): Promise<TerminalJob>;
}
```

This is a proposed Adrian interface, not a claim that Kimi exposes these exact methods. The adapter must map only operations supported by the pinned upstream runtime. Return explicit unsupported-capability errors instead of fake success.

## 6. Windows Companion

Responsibilities:
- Pair to one authenticated Adrian owner using an expiring challenge and device identity.
- Start/stop/supervise the Kimi runtime.
- Register explicit workspace roots; enforce canonical path boundaries.
- Execute allowed operations and stream ordered events.
- Report Kimi version, runtime health, OS, workspace roots and capability manifest.
- Reconnect safely, resume event cursors, and avoid duplicate command execution.
- Allow device revocation and local disconnect.
- Store local credentials using Windows protected credential facilities.
- Log redacted operational events; never log API keys or full secrets.

The companion must not become an unrestricted remote shell. All incoming operations require authenticated owner, device, session, workspace and policy checks. Use short-lived credentials, replay protection, request IDs, bounded payloads, process timeouts, output limits and explicit cancellation.

## 7. Adrian Build interface

Required desktop layout:
- Left: project explorer, workspace switcher, search, Git status and changes.
- Center: code editor, file tabs, diffs and agent conversation/task timeline.
- Right: agent context, model selection, tools, MCP, plugins, skills and task status.
- Bottom: terminal, test output, build logs and diagnostics.
- Top: project/session selector, runtime/device status, model indicator, voice control and settings.

Mobile must remain usable: project/session navigation and conversation are primary; editor/terminal can become dedicated panels or sheets. Do not attempt to squeeze a desktop three-column editor onto a phone.

Build UI requirements:
- Persistent sessions, create/resume/rename/search/export/delete.
- Stream assistant text, tool activity, progress, approvals, errors and terminal events.
- Stop/cancel; never save incomplete turns as completed.
- File tree, editor, multi-file diffs and Git actions.
- Agent/subagent status and results.
- Runtime and capability status with accurate timestamps.
- MCP/plugin/skill management and trust/permission visibility.
- Attach supported files/images/video where upstream supports them.
- Empty/loading/offline/error/reconnecting states.
- Keyboard accessibility and responsive layout.

## 8. Model/provider integration

Use Adrian's existing provider connection and model routing infrastructure. Do not create duplicate credential management. Per session/project allow provider/model selection where supported. Allow explicit compatible custom endpoint configuration. Show the actual provider/model used.

Test every provider for auth, streaming, tool/function calls, structured outputs, vision/video if applicable, context limits, cancellation and errors. OpenAI-compatible endpoints are not automatically equivalent. Kimi's official provider documentation lists provider-specific configuration and capabilities; follow the pinned version's docs.

Credentials:
- Server-side provider secrets stay in the server secret store.
- Local-only credentials stay in Windows protected credential storage.
- Never send the user's entire key inventory to the companion.
- Never store keys in localStorage, URLs, source, logs, transcripts or exports.
- No silent fallback; disabled fallback is the default unless user configures it.
- Redact errors and support key rotation/deletion.

## 9. Adrian Speak

Voice must target the active Build session through the same gateway and session ID as typed chat. Reuse existing Speak/STT/TTS/session controls where possible. Support push-to-talk or current voice mode, transcript visibility, response playback, interruption/barge-in and stop. Voice must preserve selected project/session context. Do not duplicate the voice stack. Test real microphone and speaker hardware separately; mocked tests are not live acceptance.

## 10. Data and persistence

Map to existing schema conventions before creating migrations. Proposed logical entities:
- build_runtime: owner, runtime kind/version, health, capabilities, last-seen.
- build_device: owner, paired device identity, status, revoked-at, last-seen.
- build_project: owner, project identity, workspace reference, runtime and settings.
- build_session: owner, project, upstream session ID, title, status and timestamps.
- build_event: session, sequence/cursor, type, payload reference and timestamp.
- build_approval: owner, session, exact action/target, decision, expiry and actor.
- build_provider_binding: owner, provider/model/endpoint and secret reference (never secret value).
- build_capability: runtime version, feature, support state and test evidence.
- build_audit: actor, action, target, outcome and timestamp.
- build_usage: provider/model and available usage metrics.

Every query is owner-scoped. Stable Adrian session IDs map to separate upstream IDs. Events are ordered and idempotent. Use durable DB for cloud metadata; local process disk is not cloud backup. Do not duplicate full workspace source files into relational DB.

## 11. Security and execution policy

- Owner and resource authorization on every API call, event stream and companion message.
- Device pairing, expiring credentials, replay protection and revocation.
- Canonical path validation and approved workspace roots.
- No unauthenticated terminal, open inbound local port or arbitrary shell tunnel.
- MCP/plugin trust display and per-server permissions.
- Treat repo files, tool output, MCP responses and agent-generated instructions as untrusted data; they cannot override platform policy.
- Secret redaction and protected storage.
- Bounded terminal output, runtime duration, payload size and concurrency.
- Cancellation and idempotency.
- Audit actor, action, target, approval and result.
- Emergency stop and per-session stop.
- Approval gates for installing dependencies, changing system/environment settings, adding MCP servers, operating outside approved workspace, destructive operations, production deployment, external publication and credential changes.

Approvals must bind to exact action and target. Do not make a one-time approval authorize unrelated future commands.

## 12. Implementation sequence and gates

### Phase 0 — Audit (coding agent first)
Trace actual sidebar Build action and route in current main; inspect `command-app.tsx`, route/navigation registry, app data/schema, auth guards, PC pairing, MCP, provider router, voice session, audit and test conventions. Inspect Kimi upstream source and docs. Record current main SHA and CI status. Do not edit production/main.
**Gate:** file-level implementation map, upstream API decision, dependency/licence review, capability matrix, baseline test report.

### Phase 1 — Runtime proof
Run pinned Kimi on a developer machine; build a minimal adapter proof for health, create/resume session, send prompt, stream events, stop, read/write approved workspace file and terminal command.
**Gate:** real runtime proof with evidence and no fake API methods.

### Phase 2 — Windows Companion
Pair/revoke device, secure outbound connection, process supervision, workspace allowlist, event replay and cancellation.
**Gate:** end-to-end local workspace operation and adversarial auth/path tests.

### Phase 3 — Adrian Build UI
Integrate the existing sidebar and route, workspace panels, editor, agent timeline, terminal, sessions and responsive states.
**Gate:** real coding workflow inside Adrian OS.

### Phase 4 — Kimi capabilities
Subagents, skills, plugins, MCP, hooks, media and settings, each mapped to exact upstream feature support.
**Gate:** all supported capabilities tested; unsupported items explicitly documented.

### Phase 5 — Adrian integration
Provider router, Speak, existing agent orchestration, memory/context and approvals.
**Gate:** same active session across typed, voice and tools.

### Phase 6 — Persistence and hardening
Migrations, event durability, audit, reconnect, cancellation, secret handling, limits, revocation and backups.
**Gate:** owner isolation, security, recovery and persistence tests pass.

### Phase 7 — Release verification
Typecheck, lint, focused tests, full tests, production build, runtime E2E, Windows E2E, browser desktop/mobile tests, CI and preview deployment.
**Gate:** no critical failures, no secret exposure, no regression and deployment evidence. Production release remains owner-authorized; no automatic production deploy.

## 13. Acceptance test checklist

- [ ] Build opens inside existing Adrian OS shell.
- [ ] Correct user can pair Windows Companion; another user cannot.
- [ ] Companion can open only registered workspaces.
- [ ] Create and resume real Kimi sessions.
- [ ] Send prompt and stream real assistant/tool events.
- [ ] Edit real files and display accurate diff.
- [ ] Run a terminal command and receive output.
- [ ] Stop an active command/session.
- [ ] Reconnect and resume without duplicate execution or lost completed events.
- [ ] Select provider/model and verify actual route.
- [ ] Invalid key yields clear error, no silent fallback.
- [ ] MCP, plugin, skill and subagent features work or are explicitly marked unsupported.
- [ ] Speak sends to and receives from the same Build session.
- [ ] Device revocation immediately blocks access.
- [ ] Cross-owner project/session/file/event access is denied.
- [ ] Destructive/out-of-scope commands require policy approval.
- [ ] Existing Adrian OS tests and functionality remain intact.
- [ ] Deployment and migrations are verified independently.

## 14. Non-goals and prohibitions

- Do not rebuild Adrian OS.
- Do not create a separate coding app and call it embedded.
- Do not ship an iframe-only or chat-only substitute.
- Do not claim ACP alone is full Kimi feature parity.
- Do not invent upstream APIs or capabilities.
- Do not add Kimi as a loose catalog entry and call it integrated.
- Do not bypass auth, approval, audit or execution policies.
- Do not expose credentials or terminal to the browser.
- Do not change unrelated modules without necessity.
- Do not touch the two forbidden Supabase projects.
- Do not modify Vercel secrets, run production migrations or deploy production without explicit authorization.
- Do not claim runtime/device/provider/OAuth/production status without direct evidence.

## 15. Required deliverables

1. Working Build route and UI integrated into Adrian OS.
2. Pinned Kimi source/fork with licence notices.
3. Runtime adapter with contract tests.
4. Windows Companion source and installable package.
5. Database migrations and owner-scoped persistence.
6. Provider and Speak integration.
7. Security/approval/audit implementation.
8. Capability compatibility matrix.
9. Automated unit, integration, runtime and browser tests.
10. Desktop/mobile screenshots and test evidence.
11. Operations, upgrade, backup and recovery documentation.
12. Pull request with changed-file summary, validation results and honest limitations.

**Definition of done:** A user clicks Build in Adrian OS and can perform real Kimi-powered software development within that workspace, using supported Kimi capabilities and Adrian's connected services, with secure local execution and verified persistence. A mock screen or successful frontend deployment is not completion.
