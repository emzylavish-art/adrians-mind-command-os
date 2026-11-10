# Kimi Phases 5–9 — status from this checkout

**Current branch:** `manus/phase5-provider-gating`, based on the published Phase 4 adapter branch.

This work proceeds without repeating Phases 0–3. The original Kimi worker, Build workspace and Kimi API routes are not present in this checkout, and no Kimi CLI or attached Windows machine is available. Therefore several blueprint exit gates require the next Manus session that has those files and the runtime.

## Phase 5 — providers, credentials, usage, quotas, voice, attachments

### Existing Adrian OS foundations

- Custom providers are stored in an owner-scoped server table; API keys are encrypted. The browser DTO (`PublicAiProvider`) excludes API keys, encrypted fields and base URLs. Model discovery and direct custom chat execute server-side with HTTPS/DNS pinning, redirect refusal and bounded response size.
- Custom chat refuses tool execution for these providers. Existing voice has authenticated secret minting, rate limits, emergency-stop checks, STT/TTS and live voice infrastructure. It currently routes through the direct voice provider path, not a Kimi Build session.
- Image attachments have MIME sniffing, edge and data-URL size limits, and whole-turn image caps. These checks are not yet tied to a Kimi ACP session.
- Model replies can carry token usage, and `mind_usage` stores usage records. The new pure usage-budget state machine reserves estimated tokens, settles actual usage, and holds dispatched cancellations with missing usage for reconciliation. It is not yet connected to durable task storage, so it is not a production quota control by itself.

### Added in this branch

`src/lib/mind/kimi/provider-compatibility.ts` creates a secret-free provider/model catalog and exact-selection gate. An Adrian provider is never assumed to work with Kimi: each model remains `NOT_AUDITED` until server-owned evidence for the installed `kimi-acp` runtime version confirms auth, streaming, tool-call behavior, cancellation and usage. Any failed check blocks selection; model/provider selection never silently falls back. `src/lib/mind/kimi/usage-budget.ts` implements bounded reservation, idempotency, settlement and cancellation reconciliation as a pure state machine, ready for transactional persistence by the restored task store. The 17 Phase 5 provider/usage tests are included in the normal `npm test` list.

### Still required for Phase 5 exit

- Connect the gate to the actual Build provider selector and run provider-specific probes from the Kimi runtime.
- Bridge credentials only through the existing trusted server-side secret boundary; never expose keys to browser state or logs. Do not assume the Kimi CLI config/auth format without the actual version and runtime.
- Connect the pure budget state machine to durable transactional task storage, enforce real quotas, and reconcile partial usage from the actual provider/runtime.
- Bind Adrian Speak to the same Kimi session, then test barge-in, synchronized transcripts and approval handoff.
- Pass only scanned, supported attachments into the runtime and make unsupported types explicit.

## Phase 6 — security, resilience and production readiness

Existing Adrian OS code already has owner-scoped APIs, encrypted credentials, CSRF/fetch-site guards, path limits, DNS pinning/SSRF defenses for provider/MCP calls, emergency-stop checks, rate limits and many security tests. Those are useful foundations, not proof that a missing Kimi runtime is secure. A [Phase 6 threat-model draft](KIMI_PHASE6_THREAT_MODEL_DRAFT.md) records risks and evidence gates; it is explicitly not security approval. Run the Kimi-specific adversarial suite only after the worker/API source is restored. Still required: tenant-isolation and replay tests for Kimi sessions, event/cancel races, runtime crash/restart, lease expiry, queue limits, resource/egress policy, structured redacted logs, backup/restore and rollback runbooks, privacy export/deletion review, and SBOM/license review.

## Phase 7 — preview and deployment

Local `npm run typecheck` and `npm run build` passed on this Phase 5 branch. No Kimi runtime image, preview acceptance, database migration rehearsal, authenticated browser E2E or deployment was performed. Do not deploy to production or create paid infrastructure without explicit owner authorization. When the complete implementation is restored: validate the preview checklist, exact commit/runtime image/schema digests, rollback, backup and owner approval before production release.

## Phase 8 — Windows Companion rollout

The repository checkout has the older companion, not the screen-recorded Kimi worker. No Windows device was attached; installer signing, pairing, allowed-root enforcement, outbound-only transport, token rotation, sleep/reconnect/revoke, and policy parity remain unverified. The next Manus needs the Kimi worker source and authorized Windows device. Do not claim rollout complete from the screen-recorded source summary alone.

## Phase 9 — operations

There is not yet a named runtime owner, on-call/runbook, upgrade automation, canary/rollback drill, monthly security/cost review or deployed feature matrix for the Kimi runtime. Assign these during release readiness, then schedule and exercise them against the deployed runtime. This branch does not schedule automation or change deployment settings.

## Continue from here

1. Pull `manus/phase5-provider-gating` into the original Phase 1–3 worktree; it is based on and includes the published Phase 4 adapter commit. Preserve the existing session API/workspace source.
2. Wire both capability evidence and provider evidence from the actual Kimi runtime; keep unknown states explicit until observed.
3. Complete Phase 5 integration and tests before treating Phase 6–9 deployment/rollout gates as eligible.
4. Keep preview, production deployment, paid service creation, Windows installation and secret changes behind the owner's explicit authorization.

## Validation on this branch

- Focused Phase 4–5 ACP/provider/usage tests: 26 passed, 0 failed.
- `npm run typecheck`: passed.
- Targeted ESLint with `--max-warnings=0`: passed.
- `npm run build`: passed (database migration skipped because no `DATABASE_URL`/`POSTGRES_URL` is configured).
- Full `npm test`: 1,352 passed, 0 failed, 6 canceled; the cancellations are in the existing `src/lib/mind/service-board-status.test.ts` suite (`cancelledByParent`, pending promise after the event loop resolved). The full test command exits 1; this is not reported as a pass.
