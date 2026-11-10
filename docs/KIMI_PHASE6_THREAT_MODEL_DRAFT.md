# Kimi Phase 6 threat model — draft, not security approval

**State:** Draft risk inventory only. It is not a completed security review or release authorization. The Kimi worker/session API source from Phases 1–3 is absent from this checkout, so Kimi-specific controls below remain unverified.

## Scope and trust boundaries

The intended system crosses the browser, authenticated Adrian OS server, owner-scoped database/secret vault, Kimi ACP process, Windows companion (if selected), provider endpoints, plugins/MCP servers, workspace files, and streamed events/logs. A browser-visible status or registry entry is not evidence that a runtime, provider, plugin, device, or session is live.

## Existing foundations observed in this checkout

- Provider keys are encrypted and server-side; `PublicAiProvider` omits secrets and full base URLs. Provider requests use HTTPS validation, DNS resolution/pinning, redirect refusal, bounded responses and timeouts in `src/lib/mind/ai-provider-config.server.ts` and `src/lib/mind/mcp/http-dns-pin.ts`.
- Mind endpoints use request-site/authentication guards and owner checks in existing handlers. Rate-limit helpers and stop checks exist in `src/lib/mind/limits.ts` and related API handlers.
- Phase 4 ACP helpers bound capability and event summaries, redact credential-like text, avoid forwarding tool arguments/results, suppress private reasoning, and fail closed on unverified MCP stdio mapping in `src/lib/mind/kimi/acp-phase4.ts`.
- Phase 5 provider selection requires exact Kimi runtime/model evidence; `usage-budget.ts` is a pure in-memory state machine and is not durable or connected to request dispatch.

These controls are scoped to the code paths in this checkout. They do not establish that the missing Kimi worker uses them.

## Risk register and required evidence

| Risk | Threat / failure mode | Minimum acceptance evidence before release | State |
|---|---|---|---|
| Identity and tenant isolation | A user guesses/replays another user's session, job, provider, file or approval ID. | Authenticated tests for cross-user read/write/stop/cancel/approve/list operations; server derives owner from verified auth, never request body; object IDs are owner-scoped in every query. | Open — Kimi routes absent |
| Credential theft or leakage | Provider/API/pairing secrets appear in browser state, ACP env, terminal output, event stream, logs, crash reports or diagnostics. | Secret-flow review; browser/network/log assertions; short-lived scoped leases; rotation and revocation tests; redact before persistence and streaming. | Partial foundation only; Kimi flow absent |
| Replay, CSRF and confused deputy | Repeated approvals or cross-site requests cause tool execution or provider spend under an authenticated session. | Nonce/idempotency tests; CSRF/fetch-site checks on every mutating route; approval binds exact owner, task, tool, args digest and expiry; replay rejected. | Open — Kimi routes absent |
| SSRF, DNS rebinding and redirects | Provider/MCP URLs access loopback, metadata or private network; DNS answer changes between validation and connect; redirects escape allowlist. | Pinned-address tests for DNS rebinding; IPv4/IPv6/private/reserved range matrix; redirect refusal/revalidation; egress policy verified from runtime host. | Existing provider/MCP defenses; runtime egress open |
| Path traversal and symlink escape | Workspace or attachment operations read/write outside owner-approved roots. | Canonical realpath after symlink resolution; race-safe file operations; traversal/UNC/device path tests; allow-root and revocation tests on actual Windows companion. | Open — Kimi file adapter absent |
| Command injection and unsafe execution | Task, plugin, model output or path becomes shell syntax or escapes approved executable/arguments. | No shell-string concatenation; executable/argument allowlist; sandbox tests for metacharacters, environment injection and working-directory escape; OS-level least privilege. | Open — Kimi worker absent |
| Plugin/MCP abuse | Malicious server/plugin exfiltrates data, persists, bypasses approvals or performs unbounded work. | Signed/pinned provenance, permission manifests, per-call approvals, sandbox and egress limits; deny/timeout/cancel/rollback tests; revoke test. | Open — runtime/plugin install absent |
| Resource exhaustion and runaway spend | Queue flood, unbounded output, concurrency spikes or cancellation race exhausts CPU/memory or provider budget. | Per-owner/global concurrency and queue caps; wall-clock/output limits; cancellation races; durable token/cost reservations; reconcile after cancel/crash; noisy-neighbor tests. | Partial: rate-limit helpers and pure ledger exist; durable runtime integration absent |
| Event/log privacy | Raw tool arguments, file content, private reasoning, tokens or personal data enter UI/event history/telemetry. | Allowlisted event schemas; redaction tests before stream/storage/logging; privacy retention/export/deletion checks; no hidden reasoning capture. | Phase 4 helper only; end-to-end path absent |
| Crash, restart, stale lease and duplicate events | Worker dies mid-task; old worker resumes; events duplicate/reorder; cancellation not durable. | Lease-expiry and fencing-token tests; idempotent event store; restart/reconnect tests; bounded replay window; stop/cancel recovery. | Open — Kimi task store absent |
| Backup, retention and deletion | Workspace/session/usage data remains after deletion or cannot be restored. | Data inventory; owner export/delete tests; retention schedule; encrypted backup/restore rehearsal; migration rollback tested on disposable clone. | Open — no Kimi deployment evidence |
| Supply chain and licensing | Runtime image, dependencies, plugins or installer contain vulnerable/unlicensed code. | SBOM, dependency/license review, image/signature provenance, pinned versions, vulnerability triage and upgrade rollback. | Open — no runtime artifact |

## Required execution sequence

1. Restore the actual Phase 1–3 worker/session API and identify the exact Kimi ACP version, process boundary, persistence adapter and device/host trust model.
2. Trace auth, secret, workspace, event, approval and cancellation data flow through that implementation; replace assumptions in this draft with source references.
3. Implement the missing controls and tests in the same runtime path. Do not mark a control complete based only on a helper or UI.
4. Run adversarial tests against a disposable environment, including tenant isolation, replay/CSRF, SSRF/DNS rebinding, traversal/symlink escape, command injection, plugin/MCP abuse, log leakage, crash/restart, duplicate events, queue/resource caps and cancellation races.
5. Record findings with severity, evidence, remediation and retest. Fix or explicitly block release for every critical/high finding.
6. Complete backup/restore, rollback, privacy and SBOM/license reviews before preview acceptance. Production remains separately gated by successful validation and explicit owner approval.

## Release gate

**Phase 6 is not complete.** This draft cannot be used as a security sign-off. The missing runtime source, real host/device tests, durable quota integration, threat test evidence, monitoring, runbooks, backup/restore rehearsal and dependency review remain release blockers.
