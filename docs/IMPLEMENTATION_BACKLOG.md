# Mind Command OS — Implementation Backlog

This backlog converts the intended system into verifiable engineering work. It is not a claim that these features are complete. Update each item with a commit, test result, or live verification record when finished.

## P0 — Establish trustworthy baseline

- [ ] Inventory routes, packages, database migrations, agent code, scripts, deployment configuration, and tests.
- [ ] Run build, typecheck, lint, and test commands; capture exact commands, exit codes, and known failures.
- [ ] Reconcile conflicting docs and mark stale claims with corrections.
- [ ] Review environment examples and tracked files for secrets; verify ignore rules cover local credentials/runtime artifacts.
- [ ] Audit the Windows installer ordering and configuration generation; test install/uninstall/stop paths in a disposable Windows environment.
- [ ] Create a capability matrix with evidence and owner for every integration.

## P1 — Reliable agent execution core

- [ ] Define typed task, agent, tool-call, approval, result, and evidence schemas.
- [ ] Implement durable job storage and a worker that actually polls/claims jobs with leases.
- [ ] Add retry/backoff, idempotency keys, timeouts, cancellation, dead-letter handling, and restart recovery.
- [ ] Add task trace IDs and structured event logs.
- [ ] Define agent registry: role, prompt/version, tool allowlist, permission tier, budget, concurrency, and delegation depth.
- [ ] Enforce delegation depth and concurrency in code, not only prompts.
- [ ] Implement specialist dispatch and result validation; reject malformed or unsupported claims.
- [ ] Expose runtime readiness separately from configuration readiness and service connectivity.

## P2 — Real integration adapters

- [ ] For each provider, define required credentials, scopes, health check, supported operations, and failure states.
- [ ] Implement actual adapter calls and contract tests; do not treat stubs as connected.
- [ ] Add OAuth state/PKCE and secure token storage where applicable.
- [ ] Add connection checks that do not reveal secrets.
- [ ] Add tool/skill manifest with version, source, license, compatibility, permissions, install instructions, and test status.
- [ ] Make tool installation explicit, reversible, and auditable.

## P3 — Monitoring and recovery

- [ ] Add configured target registry for websites/services, schedule, expected response, and safe check policy.
- [ ] Run health checks through a durable scheduler and record uptime, latency, errors, and evidence.
- [ ] Detect expired sessions/login challenges; alert and pause protected workflows rather than bypassing them.
- [ ] Add incident lifecycle: detected, triaged, action proposed, approval requested, resolved, verified.
- [ ] Implement bounded, reversible recovery actions with dry-run and approval policy.
- [ ] Add alert delivery configuration and test notifications.

## P4 — Browser and action governance

- [ ] Separate observe/read from write/submit/publish/delete operations.
- [ ] Require explicit approval for consequential external actions.
- [ ] Record target, action, rationale, approval identity, timestamp, and outcome.
- [ ] Support screenshot/DOM evidence where permitted and redact sensitive values.
- [ ] Provide stop button, global kill switch, and per-agent cancellation.
- [ ] Verify policy enforcement in automated tests.

## P5 — Memory, knowledge, and self-improvement

- [ ] Implement source-linked memory with provenance, timestamps, confidence, and conflict resolution.
- [ ] Add retention/deletion controls; avoid storing all conversation text by default.
- [ ] Evaluate retrieval quality with a repeatable test set.
- [ ] Add failure-to-test-to-issue workflow; include reproduction and redacted logs.
- [ ] Allow agents to propose code changes in branches/PRs; require configured review before merge/deploy.
- [ ] Add release notes and rollback instructions.

## Definition of done

A capability is done only when implementation is present, a relevant automated test passes, configuration/permissions and failure modes are documented, and its status is supported by evidence. Live claims require a timestamped real-service verification record.

## Guardrails retained

- Do not touch Oak Bridge Capital or BridgePoint.
- Do not use the protected Supabase project IDs previously excluded by the owner.
- Do not add a paid database/service without explicit approval.
- Do not expose or commit secrets.
- Do not delete database tests or weaken tests merely to obtain a green result.
- Do not claim hosted workers, provider connections, or local installation unless verified.
