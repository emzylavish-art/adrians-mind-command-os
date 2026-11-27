# C3 implementation verification and integration notes

## Scope and source identity

This branch implements the recovered **Adrian Analysis — Continue Production Audit**, chapter **C3**. The [chapter](https://app.notion.com/p/4231aa276323819f92ece254a4708b65) belongs to the [saved audit archive](https://app.notion.com/p/4231aa2763238172a515d9ecebc9aa3d). The recovery covers 43 original records and 256 finding IDs. AA-001 survives in the cumulative record; its standalone first report was not recovered. Requirements appearing after embedded visual proposals were recovered and included in the machine-readable checklist.

Base: `18d5b9364e6bdcfec028eeccf56fe596946ed8ce`.

Website branch: `audit/continue-production-c3-20261125-659f`.

Native branch: `audit/continue-production-c3-native-20261125-659f`, published head `bdd0c0204955b5446a5d0048d28c131969390bcd`, [draft PR 65](https://github.com/emzylavish-art/adrians-mind-command-os/pull/65). Its published tree `206df7d8d3d887a87d26dfcf34c3d2810b3655b4` exactly matches the independently tested local native tree. The website branch does not contain those 52 native files. The native draft PR's existing GitHub verification workflow completed successfully ([run45752665011](https://github.com/emzylavish-art/adrians-mind-command-os/actions/runs/45752665011)); that workflow name is not a claim of deployment or physical Windows verification.

The complete finding-to-code/test mapping is [findings.json](findings.json); [CHECKLIST.md](CHECKLIST.md) is its compact index. All 256 IDs have an explicit disposition. The mapping includes 249 entries fixed and tested, 2 already fixed with proof, 3 blocked entries and 2 proposals requiring a product/infrastructure decision. These are finding entries, not 249 independent bugs or live-provider certifications.

No branch was merged, no release was made, and no production setting, account connection or real provider was changed or exercised.

## Implemented behavior

| Area | What changed and why | Verification scope |
| --- | --- | --- |
| Account, workspace and retention | Owner-scoped preferences/drafts, identity-conflict handling, session controls, transactional resource writes, compare-and-swap revision checks, tombstones, incremental autosave, safe selective restore and explicit browser/server retention boundaries prevent cross-account reuse and silent replacement. | Deterministic account/state fixtures and isolated SQL; authenticated production accounts were not used. |
| Notion, plugins and skills | Ambiguous destinations expose a real picker with pagination; permission failures do not widen scope. Reviewed, account-owned skill versions govern tool availability. Chat, hosted Build and paired Build preserve considered/applied/non-use receipts, including unavailable dependencies and context/scope/disabled omissions. The client cannot invent positive execution or verification proof. Queued Build receipts survive owner-scoped polling and reload. | Fake service responses, isolated paired-job storage and server/client contracts; no Notion or plugin action was executed. |
| Providers and voice | Native and configured adapters preserve selected provider/model, incremental text, returned usage and reported cost. Explicit metadata refresh stores owner/credential-bound model catalogues; picker, Auto validation and dispatch use the same observed availability and capability limits. Stale/removed models require an explicit compatible choice. Helpers are prevalidated and their receipts survive a primary failure. Voice separates input, answer and output; late playback respects interruption. Approved retries retain exact bounded ephemeral audio/request snapshots only after explicit whole-operation no-dispatch proof. | Delayed/error stream fixtures, changed synthetic model catalogues, exact-request recovery and owner/generation guards. Metadata discovery is distinct from inference proof. Real speech providers and physical audio remain untested. |
| Money and execution | Atomic owner policies cover request counts, day/week/month commitments, provider/project/task scopes, exact expensive-operation review and fresh verified free pricing. Three-stage Speak shares a task budget. Legacy chat/image RPCs and each bounded-agent model round also pass through the shared gate; immutable planner retries require whole-run no-dispatch proof. Unknown charges retain conservative holds. Fleet plans, approvals, external effects and schedules use durable server-owned state and no automatic replay of unknown effects. | Isolated real PGlite transactions plus fake providers. Owner estimates are explicitly estimates; they are not guaranteed upstream invoice caps. See [financial notes](../C3-financial-implementation.md). |
| Chat and research | Stable send IDs, partial-versus-complete output, structured error recovery, bounded transcript rendering, branching/version history, full-text search and versioned research attachments preserve source and retry context. Manual comparison retains provenance and marks hypotheses. | Normal-runner fixtures and browser navigation/layout states. |
| Memory, files and artifacts | Account/project authority, freshness and retrieval budgets govern context. Original file bytes and generated artifacts have stable provenance; same-ID version changes cannot retain stale image bytes. Worker-based metadata loading and background media hydration keep metadata complete before autosave. | Indexed storage/service fakes, real worker fixture, version/owner races and large-workspace cases. |
| Build and Intelligence | Read/save limits and complete file/context receipts align; partial work is retained on failure. The mounted Build-to-Intelligence handoff preserves exact supported text, verifies destination readback, scopes it to owner/thread and keeps Temporary content in memory. Failed sends retain their draft. | File/adapter fixtures, full-text handoff above the former 4K boundary, storage failures and account isolation. No hosted build provider or real command execution was used. |
| Dashboard, notifications and interface | Dashboard distinguishes source freshness, partial failures and configuration from action proof. In-app notifications have stable event identities, exact approval destinations and distinct read/dismiss state. Scoped menus, shared dialogs, scroll restoration, accessible controls and responsive composer sizing repair the measured layout defects. | Synthetic browser states, focus/scroll assertions and structured health/event fixtures. Cross-device push remains explicitly unimplemented. |
| Verification and release preparation | The normal runner discovers deterministic tests recursively; shards use the same inventory. Migration checksums, atomic application and old-version compatibility are tested. Build no longer silently applies schema changes. Release evidence binds checks to an exact candidate/environment and refuses stale, incomplete or fixture-only production proof. | Normal test runner, compatibility database and release-gate negative fixtures. No promotion was run. |

## Verification record

Final command results, counts, skipped test names, log hashes and source identity are retained in [evidence/verification.json](evidence/verification.json). Browser reports and selected screenshots are retained under [c3-visual](../c3-visual/). These artifacts are part of the pushed branch.

The verification sequence includes the entire normal `npm test` inventory, full TypeScript checking, a sanitized production build with authentication enabled, a separate isolated authentication-invariant probe, AST architecture checks, scoped and whole-repository lint, and `git diff --check`. The repository-required bootstrap/manifest JSON checks and four Python unittest groups passed; the Python groups ran 97 tests in total. Their exact commands/results are in [standard-validation.json](evidence/standard-validation.json).

Whole-repository ESLint has existing errors at the base revision. The baseline comparison in [lint-comparison.json](evidence/lint-comparison.json) identifies introduced errors separately; introduced errors were corrected. Do not present the whole-repository lint command as a pass.

The local browser fixture uses synthetic owner/workspace data, fresh disposable storage, blocked real APIs/providers and Chromium 153. It exercises 390×844,844×390,320×500 and1024×768 with 200% text, with 1/50/500/2000-message conversations, long drafts/attachments, drawer/header reachability, modal focus and section scroll restoration. The additional empty-registry cases compare a controlled service response with the unavailable-service cases. Linux viewport simulation is not physical iPhone/Android evidence. Its timing observations are development-fixture measurements, not field INP. Proposed 2.5s LCP, 200 ms interaction and 0.1 CLS targets are reported separately from functional assertions; failures of those targets must not be described as passed performance gates.

Earlier verification exposed and led to repairs for landscape/large-text Send clipping, an incorrectly visible desktop mobile-menu trigger, stale same-ID artifact previews, exact approval retry identities, and source-contract assertions that no longer matched the guarded dispatch structure. Final checks are recorded after those repairs; planned live tests are not counted as passes.

## Migration and reconciliation requirements

New additive migrations are:

1. `0017_c3_provider_readiness.sql` — truthful provider discovery/readiness metadata.
2. `0018_c3_memory_policy.sql` — persistent owner memory/privacy policy.
3. `0019_c3_dispatch_controls.sql` — shared atomic request policy/buckets.
4. `0020_c3_media_jobs.sql` — durable owner-bound video jobs.
5. `0021_c3_financial_policy.sql` — monetary policies, reservations, reviews, pricing evidence and invoice corrections.
6. `0022_c3_media_request_identity.sql` — immutable video request fingerprints and project/task scope for known-unsent recovery.
7. `0023_c3_environment_model_catalog.sql` — owner/credential-bound metadata catalogues for configured environment providers; model discovery remains an explicit action and does not establish inference verification.

Reconcile numbering and schema names with the other audit branches before promotion. Do not edit checksums of an already applied migration. Preserve the order of the media-job and media-request-identity migrations. Migration compatibility tests dynamically apply all candidate migrations after the old baseline and verify that the old workspace/provider SQL contract still works after a candidate failure.

`npm run build` deliberately no longer applies migrations. Integration Codex must use the reviewed compatible migration step with exact candidate evidence before production promotion. Do not silently restore implicit migration during an unverified build.

Shared integration hot spots include `command-app.tsx`, `chat-pane.tsx`, `workspace.ts`, `types.ts`, `store.ts`, `server.ts`, `turn.server.ts`, `provider-call.ts`, provider/voice/media adapters, Build surfaces, global/scoped CSS, `package.json`, test discovery, migration scripts and the generated route tree. The native branch also changes `command-app.tsx`, `turn.server.ts`, package scripts, Vite configuration and PC/update endpoints. Merge behavior deliberately even where Git can merge the text cleanly. Regenerate route declarations once after combining the routes. Retain the expanded test inventory and distinct regression cases.

## Open entries and evidence boundaries

- **AA-022 and AA-025:** the website handoff and local Build browser controls do not implement an independently hosted autonomous browser with secure authenticated owner takeover, durable tasks and controlled downloads. Select/provision that browser execution and takeover architecture before implementing the proposed product workflow. Current controls retain accurate capability/permission boundaries.
- **AA-167:** the native branch implements the shared owner/workspace operation contract and truthful platform matrix. Native iOS/Android shells, secure platform storage/media/lifecycle/notification adapters and signed installable builds remain unimplemented. They must stay separate from website release proof.
- **AA-174:** the in-app inbox/event contract is implemented. An authenticated cross-device subscription/delivery service, shared read-state transport and Web Push/APNs/FCM/Windows integration are not implemented. Provision the chosen delivery service and consent flow, then test a synthetic background completion on a second authorized device; browser-local execution is not background server execution.
- **AA-235:** actual iPhone/Safari, Android and installed Windows behavior requires representative physical devices. Run keyboard/safe-area/touch, permissions, lifecycle/resume and installation checks. Linux screenshots do not satisfy this entry.

The native release additionally needs reviewed publisher public keys/certificate, a signed schema-v2 release manifest and actual Windows install/update verification. Those are intentionally absent rather than fabricated. Real provider availability, credentials, quotas, actual invoices and playback remain later authorized checks. The tested compiled website is not evidence of a deployed release.
