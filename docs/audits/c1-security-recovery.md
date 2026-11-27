# C1 request contracts and durable recovery

Audit chapter C1 — Notion Access Audit (`4231aa2763238138937ec5a478120d17`). Base `18d5b9364e6bdcfec028eeccf56fe596946ed8ce`; branch `audit/c1-notion-access-ef0782`. This implements recovered AA060 and AA069–074, not a new audit. Final full-branch results and pushed SHA belong in `c1-checklist.md`.

## Implemented findings

| Original finding | Status | Actual change | Regression evidence |
|---|---|---|---|
| AA060 — separate request-isolation mechanisms | fixed and tested | Central explicit policy inventory covers **72 route files / 104 HTTP method contracts / 58 exported RPCs**. TypeScript AST discovery fails on unreviewed endpoints/methods/exports and missing guard call markers. Public manifests/status, credential establishment, owner mutations, OAuth callbacks, paired devices and loopback-only key copy keep distinct policies. Add origin guards to owner pairing mutations and PC/status POST; origin-only middleware protects login/signup/OAuth start/signout/local key copy without requiring a preexisting login. | `scripts/security/endpoint-inventory.test.mjs` + `request-guard.test.ts`: 9/9. Inventory includes actual delegated guard sources, not merely route filenames. See `docs/verification/endpoint-security.md`. |
| AA069 — wording-based classification | fixed and tested | Versioned machine envelope preserves code, subsystem, operation/provider, stage, retry policy, outcome certainty, operation kind, optional status and delay. Actual Chat/resource/research/media/voice JSON helpers emit it; provider relay SSE and actual client HTTP/SSE consumers retain it. CommandApp uses the envelope first. Notion bridges its structured failure evidence. Legacy string classifier remains a compatibility path only. | `failure-envelope.test.ts`: changed wording/ambiguous save text cannot change structured classification; success payload unchanged; unknown outcome stays unknown; actual HTTP/SSE/relay fixture. Resource-policy/Free-only/halt/auth/permission codes have different recovery policies. |
| AA070 — incidents tied to short activity retention | fixed and tested | Owner-scoped separate journal keeps open/recovering incidents beyond activity trimming. Owner filtering prevents another account's rows from rendering or being written. Temporary conversation incidents are not journaled, and their error audit content is not added through the new journal path. | `incidents.test.ts`, envelope reload/privacy tests, actual recovery-card render tests. |
| AA071 — unrelated success clears failure | fixed and tested | Generic target success cannot resolve v2 incidents. Resolution requires same owner, exact operation/recovery relationship, bound resource/revision and explicit checks for the actual verified outcome. Missing operation IDs cannot be matched to an unrelated later success. Acknowledgement remains distinct. | Exact-proof wrong-operation/wrong-binding/missing-check tests; CommandApp successful Chat/Notion/research/media/server-save paths supply available actual evidence. Unconfirmed outcomes remain open. |
| AA072 — retry discards problem | fixed and tested | Same operation retains incident identity and recovery attempt history. Starting review/retry records recovering; a failed retry keeps the attempt and returns open. Two failed operations at one target stay distinct. | Same-target/different-operation and failed-recovery-identity tests. |
| AA073 — Notion timeout implies no write | fixed and tested | Retains connector lane's typed outcome observation and uncertain append wording. The recovery adapter maps append to write, permission to specific repair, and accepted/unverified to partial outcome. No automatic append repeat or old confirmation reuse. | Connector lane `c1-notion-recovery.test.ts`; `failure-envelope.test.ts` structured permission and uncertain append tests; existing Notion failure tests. |
| AA074 — callback is not durable plan | fixed and tested | v2 serializable descriptor retains operation, owner, chat/workspace/page/grant/connection/report/configuration bindings, safe strategy, required checks, delay and attempts. It contains no prompt, credential, callback or approval. Actual card opens original Chat/Plugins/research/Library media history/Settings review. Voice recovery opens Settings → Voice and does not start capture or a provider call. Only same-ID Chat receipt/read retry can retain an in-session retry callback; uncertain writes/generation reopen review. | Reload, account/grant/destination drift, halt, rate delay, reauthentication, no-prompt/approval persistence, same-ID Chat replay, actual rendered destination/uncertainty/checks and blocked-card tests. |

## Files and actual commands

Implementation: `src/lib/mind/{failure-envelope,incidents,failure-states,stream,live-turn,relay}.ts`, `turn.server.ts`, `resource-http.server.ts`, `research-http.server.ts`, `media/imagine-http.ts`, `voice/http.server.ts`, `components/mind/{command-app,use-mcp-failure-mount,incident-recovery-card}.tsx` (hook file is `.ts`), auth middleware/session actions, PC/status/pairing guards, and `scripts/security/endpoint-inventory.{mjs,json}`.

Executed targeted command:

```sh
node --experimental-strip-types --test --test-concurrency=1 \
  src/components/mind/incident-recovery-card.test.ts \
  src/lib/mind/failure-envelope.test.ts \
  src/lib/mind/incidents.test.ts \
  src/lib/mind/failure-states.test.ts \
  src/lib/mind/live-turn.test.ts \
  src/lib/mind/relay.test.ts \
  scripts/security/endpoint-inventory.test.mjs \
  src/lib/mind/request-guard.test.ts
```

**77/77 passed, zero failed/skipped**, approximately 2.5 seconds. This supersedes the initial 64-test structured-recovery batch. Source transpilation of actual CommandApp/new components reported no syntax errors. Root owns final full TypeScript/normal runner/build checks after all edits. A narrow policy-code refinement and final HTTP-code annotations are retested in the final targeted result below before handoff.

Final policy/HTTP propagation follow-up: `voice/transcription-policy.test.ts`, `failure-envelope.test.ts`, `incident-recovery-card.test.ts`, and `scripts/security/endpoint-inventory.test.mjs` passed **21/21**. `surface-failure-host.test.ts` then passed **5/5**, including the actual structured Research reporting seam and the retained legacy fallback. These are targeted results; the consolidated normal-runner result belongs in the master checklist.

## Migration upgrade proof and rollout contract

`scripts/c1-migration-upgrade.test.mjs` is discovered by the normal `npm test` runner. It creates an isolated in-memory PGlite database without reading any configured database URL or existing data directory, applies the **14 actual pre-C1 SQL files**, seeds synthetic legacy OAuth, archived workspace and completed turn receipt rows, and then applies `0017` through `0021` in separate recorded transactions. It verifies all **12 new tables**, preserves existing encrypted-token strings and workspace records, initializes a grant generation without inventing an external account identity, and leaves newly added response fields null on old completed receipts. It then writes representative new policy/media/research records and deliberately replays the five additive SQL files: the grant generation, legacy receipt and new data stay intact, and deleting a research report cascades to its versions.

Executed:

```sh
node --experimental-strip-types --test --test-concurrency=1 \
  scripts/c1-migration-upgrade.test.mjs \
  scripts/migration-plan.test.mjs
```

**8/8 passed, zero failed/skipped**, approximately 4.5 seconds. Normal test discovery independently confirmed inclusion of the new upgrade fixture. This is actual SQL compatibility proof in a disposable PostgreSQL engine; it does not claim a hosted database was migrated.

For the later authorized rollout and rollback:

1. Apply `0017_c1_oauth_contract.sql` → `0021_c1_research_skills.sql` in that order before serving the new code, through one serialized migration process. Both the deployment migrator and PGlite bootstrap track migration **basenames**; do not rename or edit previously applied files as a migration strategy.
2. Retain the existing connector encryption secret. Schema migration preserves encrypted values and cannot recover them if the encryption secret changes.
3. Old completed turn receipts retain their response/completion flags but have no newly stored response body. Missing historical response content must stay unavailable; it is not permission to repeat a paid or consequential request.
4. Legacy device filesystem data needs its separate explicit import via `scripts/import-c1-device-state.ts`: back up the source, pause old writers, inspect the read-only dry run, and authorize application only into the intended empty owner target. The import marker prevents replay and resurrection. No production device data was imported by this implementation.
5. If reverting application code, retain the additive tables and columns so new records are recoverable. Pause execution before using an older runtime that does not enforce the new shared spending and durable device authority; a code rollback does not justify deleting those records.
6. Before a hosted release, confirm database role/table exposure remains server-only or has the intended grants and row policies. The isolated owner/query fixtures and PGlite SQL test do not establish Supabase Data API permissions or a production role configuration.

## Boundaries

- Journal durability is **this browser, scoped to the account**. Cross-device incident storage is not implemented or represented as available. Saved server operation receipts and research/media history remain separately owner-scoped and durable.
- Inventory guard markers establish a reviewable source contract; they do not prove penetration testing or that every possible operation was exercised live. Executable isolation fixtures and the other lanes' owner/device/OAuth tests provide the stated local proof.
- Receipt/read replay does not authorize a new external write. Current server owner, halt, context, connection and spending checks still run where a new dispatch could occur. A previous completed receipt may be inspected while execution is halted.
- No real provider, OAuth renewal, external write, physical device, account setting or production database was exercised by these fixtures.
- Full rollout/CI/deployment and exact pushed SHA are root-owned final evidence. No merge or deployment is claimed.
