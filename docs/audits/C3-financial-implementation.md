# C3 AA-041 — Usage & budgets implementation

Base: `18d5b9364e6bdcfec028eeccf56fe596946ed8ce`; website branch `audit/continue-production-c3-20261125-659f`.

Original: [C3/M11](https://app.notion.com/p/4231aa27632381a9b336c91893fc0102), [exact original message](https://chatgpt.com/c/6b071d2c-12e4-83e9-a620-2e4b93d18b11?messageId=18b757a6-ec42-4b85-8bbf-3f59ae31e19d). The original proposed product enhancement is implemented under the user's later authorization. No fresh audit finding was added.

## Implemented

- Added an opt-in USD policy with daily UTC, Monday-week, calendar-month, provider monthly, project monthly, and per-task caps. One atomic owner-row lock serializes request-count and monetary reservations before provider dispatch. Delegated fleet children and helpers share their parent's task identifier while each actual call retains a distinct operation ID.
- Before an unpriced operation can run, an owner must provide a positive, expiring provider/model request ceiling. Every such amount is labeled **owner estimate**, not a published rate or proven invoice. Enabling the policy with missing identity, model, price evidence, atomic storage, or remaining allowance fails before the provider is called. Disabled policy retains the normal request-count control behavior.
- Added exact five-minute single-use review for execution above the owner's automatic threshold. Scope includes operation, provider/model, project/task, immutable argument digest, ceiling, and policy revision. Policy changes revoke old reviews. Revoked, consumed, changed and expired reviews cannot authorize dispatch. Pending review does not charge request counters or money.
- Added an owner-private ledger. Known not-sent attempts release a reservation. Missing actual dollars preserve a conservative unknown hold; token counts never become a fabricated USD amount. A real USD receipt settles the hold. OpenRouter receipt parsing supports exact microdollar `usage.cost`, preserves the reported credit amount separately, and refuses to treat submicro precision or BYOK's potentially separate upstream bill as a complete-cost receipt.
- Added owner-confirmed invoice/correction records, retained previous amounts, idempotent correction references and export. Corrections above the estimate reduce allowance and block later work. Export contains up to 1,000 ledger rows and 1,000 reconciliation records and explicitly marks omitted older history.
- Added a deliberate button to read official public OpenRouter model metadata with a fixed URL, no redirect, an eight-second deadline, bounded streamed body, strict known all-zero price fields, duplicate detection and fifteen-minute expiry. A matching canonical OpenRouter text-only request is required. Unknown conditional price overrides, positive charges, missing rates, custom endpoints, audio/image/tool contexts and stale evidence do not qualify as verified free. Failed refresh never extends previous evidence.
- Added Settings UI through existing SpendingControls and authenticated/same-origin/no-store dispatch-policy handlers. It shows commitments, unknown charges, scopes, owner estimates, pending expensive reviews, verified free models, invoice reconciliation and a labeled export.
- Connected fleet uses the shared reservation/settlement helper and exact selected provider/model/project/parent-task metadata. A budget refusal before reservation pauses the run; explicit Resume requires a fresh tool authorization and retains the same monetary operation identity. An unknown dispatch remains nonreplayable. A known-unsent attempt whose financial reservation was already closed requires a new run and cannot reuse the closed operation ID. Server-authoritative receipts cannot be advanced or changed to completed by browser snapshots.
- The HTTP bounded-agent path reserves every actual model round separately under one task/project and a stable request root. Each round binds its exact model body and records requested/reported model, request ID, token receipt and dispatch state. Stop, saved-context privacy, current model catalogue and credential identity are checked again before each call and after reservation. Initial monetary refusal makes no provider call; later refusals preserve the prior tool log and cannot replay the whole run. No provider fallback or previously blocked Imagine capability was enabled.

## Verification

Financial core targeted command, recorded before the final Speak supplement:

```sh
TMPDIR=/workspace/scratch/659f1d0aea7c/financial-tmp node --max-old-space-size=256 --max-semi-space-size=8 --experimental-strip-types --test --test-concurrency=1 src/lib/mind/financial-policy.test.ts src/lib/mind/dispatch-controls.test.ts src/lib/mind/provider-usage.test.ts src/lib/mind/fleet-dispatch.test.ts src/lib/mind/fleet-external.test.ts src/lib/mind/dashboard/operational-health.test.ts
```

**53 passed, 0 failed, 0 skipped.** The financial SQL fixtures create one isolated in-memory PGlite engine and apply migrations0019 and0021 there; they never open application storage. The test suite exercises concurrent reservations, every budget scope, owner separation, old unknown holds, known versus unknown dollar settlement, invoice corrections, CAS, exact review/expiry/consumption, fresh versus changed eligibility, timeout/oversize/malformed catalogues, receipt precision and fleet recovery. Normal test inventory discovers these files automatically.

Targeted ESLint passed for financial policy/server/tests, provider usage/tests, fleet dispatch/connected adapter, financial UI, dispatch-policy route and public dashboard DTO. New control-character checks use Unicode Cc; no new suppression was added. Scoped diff check passed. Final combined typecheck, full suite, build and browser outcomes remain pending until recorded in the [consolidated verification record](c3-continue-production/VERIFICATION.md); earlier scoped runs do not establish final-build proof. A redundant narrowed comparison reported by an earlier combined TSC run was removed from `preserveServerRunAuthority` without changing behavior.

### Final Speak integration recovery

The monetary review path now retains the exact captured audio and MIME only in bounded, ephemeral retry state when the input server explicitly confirms `dispatched:false`. Retrying after approval reuses those bytes instead of recapturing a different request. Ambiguous input failures cannot replay. Once a transcript succeeds, input audio is discarded and answer recovery never repeats transcription.

An explicitly unsent answer is retryable only with its original chat, operation ID and bounded deep snapshot of the request body. Ambiguous answer failure retains the prior nonreplayable behavior. A completed answer discards its request snapshot; output/playback recovery still uses the retained answer and available audio. These snapshots are not written into account metadata or stage receipts. Mounted dispatch wiring keeps one task identity across speech input, answer and output.

Additional command:

```sh
TMPDIR=/workspace/scratch/659f1d0aea7c/financial-tmp node --max-old-space-size=256 --max-semi-space-size=8 --experimental-strip-types --test --test-concurrency=1 src/lib/mind/voice/speak-action.test.ts src/lib/mind/voice/speak-mounted.test.ts src/lib/mind/voice/speak-e2e.test.ts src/lib/mind/voice/speak-output-contract.test.ts src/lib/mind/voice/direct-mode.test.ts src/lib/mind/voice/error-contract.test.ts src/lib/mind/financial-policy.test.ts
```

**45 passed, 0 failed, 0 skipped** (`speak-retry-integration.log`). This overlaps the financial suite above and is not an additional 45 distinct tests. The SQL fixture verifies two unknown-cost stages consume the shared task allowance and block output over the cap. Voice fixtures verify exact audio/request recovery, no repeated capture/STT after success, immutable bounded snapshots, ambiguous no-replay, preserved output replay and mounted stage order. Scoped lint passed for all five changed code/test files. No live audio, provider, account or invoice was exercised.

### Bounded-agent per-round integration

```sh
TMPDIR=/workspace/scratch/659f1d0aea7c/financial-tmp node --max-old-space-size=256 --max-semi-space-size=8 --experimental-strip-types --test --test-concurrency=1 src/lib/mind/agent-model-dispatch.test.ts src/lib/mind/agent.test.ts src/lib/mind/integration-voice-banner.test.ts src/lib/mind/integration-security-c17.test.ts src/lib/mind/integration-security-c19.test.ts src/lib/mind/request-body.test.ts scripts/mind-endpoints.test.mjs
```

**77 passed, 0 failed, 0 skipped** (`agent-model-dispatch-tests.log`): eleven new adapter cases plus existing bounded-agent, auth/body and mount contracts. Real isolated SQL reservations and fake provider responses prove initial review makes zero calls, changed arguments cannot reuse approval, exact retry can proceed, later rounds share the cap, stop/privacy/catalogue/credential loss prevents the next call, a stop during reservation releases known-unsent cost, ambiguous calls cannot replay, and settlement outage preserves the received answer and conservative hold. Existing tools/log/images remain intact. Scoped ESLint passed for the handler, helper and tests. No live model or account storage was used. Final combined gates remain pending in the consolidated verification record.

One preliminary command used unavailable `tsx` and failed before loading tests; it was immediately replaced with this repository's native Node type-stripping test invocation. No package was installed.

## Shared files and integration dependencies

- Requires migration `0021_c3_financial_policy.sql` together with existing `0019_c3_dispatch_controls.sql`; migrate before enabling the policy. No migration was executed on production or app data.
- `dispatch-controls.server.ts` remains the single shared request-count + money gate. Primary/helper, RPC speech/research, HTTP voice, media and hosted Build metadata/settlement wiring uses `dispatch-attempt.ts` and `rpc-provider-request.server.ts`; preserve all of it when integrating. Model-less or unpriced operations fail closed while monetary policy is enabled.
- Shared changes: `fleet.ts` (optional project/task request metadata, known not_sent receipt), `fleet-external.ts`, **only the `preserveServerRunAuthority` helper** in `store.ts`, dashboard operational-health labeling, provider usage receipts, and the existing SpendingControls/dispatch-policy surfaces.
- `provider-usage.ts` now adds optional `actualCostMicros`, `reportedCostUsd`, `currency`, and `costScope` fields. Keep token usage separate and preserve financial unknown values.
- Financial APIs: `reserveOwnerDispatch(owner, sql?, now?, context?)` returns optional reservationId; `settleOwnerDispatch(owner, reservationId, receipt, sql?)` retains a hold if actual USD is absent. Context includes stable operationId, actual provider/model, project/task, immutable request hash, and compatible textOnly flag. Never generate a new operation ID simply to bypass an unresolved prior reservation.

## Boundaries and acceptance after integration

No real provider, live invoice, external database, account save, production migration or deployed browser money-policy mutation was exercised. The fixtures establish application behavior, not an upstream bill or real account eligibility. Final browser outcomes remain pending until recorded in the [consolidated verification record](c3-continue-production/VERIFICATION.md). Browser layout and navigation fixtures do not establish an authenticated monetary save.

These are **commitment limits using owner estimates**. A provider's actual bill may exceed the owner's estimate; the UI states this. A lower estimate is not proof of a lower charge. Invoice reconciliation is owner-reported and retains that basis. Model-less sessions cannot establish an exact pricing scope and remain blocked while monetary limits are enabled. Custom providers do not inherit official OpenRouter free proof. Text-only free evidence is time-limited and an unavailable free route never becomes a paid fallback.

Release gate: run combined normal tests/typecheck/build; review every actual call surface's provider/model/task identity and stable explicit-retry ID; exercise Settings with disposable owner A/B and fake providers (simultaneous last-budget calls, high-cost one-shot review, changed request/price policy, missing dollar receipt, over-estimate invoice, revoked/free eligibility, callback storage outage); verify migration order. Live billing/device/provider proof requires a separately authorized controlled run, not a copied fixture receipt.

Upstream facts used only for parsing contracts: [OpenRouter Usage Accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [OpenRouter Support — USD credits and BYOK](https://openrouter.ai/support), and [Models pricing schema](https://openrouter.ai/docs/guides/overview/models), read2026-11-26. No catalogue inference or account API request was made during implementation.

## Final integrated legacy entry points

The final website branch also meters the authenticated legacy `sendTurn` and `analyzeImageFile` RPCs and every actual model round of `/api/mind/agent`. `legacy-turn.server.ts`, `image-analysis-dispatch.server.ts` and `agent-model-dispatch.server.ts` apply the shared policy before fetch. Exact operation/task/project identities and request digests remain bound to the original request. A changed stop/privacy/catalogue state blocks subsequent dispatch; unknown effects keep their holds.

`agent-request.ts` preserves bounded owner-specific request JSON for an explicitly known-unsent retry and rejects retry for another owner, another operation, a partial run, an ambiguous outcome or a released closed reservation. The mounted planner keeps requested and reported model identity distinct and shows per-round response receipts. No provider price or invoice amount was fabricated. The final normal runner includes these regressions; its exact counts and remaining skips are in [verification.json](c3-continue-production/evidence/verification.json).
