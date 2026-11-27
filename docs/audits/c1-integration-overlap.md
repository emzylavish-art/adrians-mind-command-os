# C1 cross-branch integration notes

C1 implementation: `b17e90c5728f7f1a9f303f703fcf073cbdd2175e`. This read-only snapshot was taken before the C1 push. No other audit branch was edited, merged, or claimed tested. Re-fetch the exact referenced heads; they may advance.

| Other branch | Inspected head | Files also changed by C1 |
|---|---|---:|
| [audit/adrian-analysis-66-1125](https://github.com/emzylavish-art/adrians-mind-command-os/tree/217d95b453e79c25de6cc43a4adfffb0c387695d) | `217d95b453e79c25de6cc43a4adfffb0c387695d` | 47 |
| [audit/adrian-analysis-c5-1125](https://github.com/emzylavish-art/adrians-mind-command-os/tree/a9e198dda212e95d4384f31faa64cb60ff49f17a) | `a9e198dda212e95d4384f31faa64cb60ff49f17a` | 40 |
| [audit/c2-notion-recovery-20261125-5f8234](https://github.com/emzylavish-art/adrians-mind-command-os/tree/5aa2c2c909278fae9b2af3a4861520c0e3feed66) | `5aa2c2c909278fae9b2af3a4861520c0e3feed66` | 46 |
| [audit/continue-production-c3-native-20261125-659f](https://github.com/emzylavish-art/adrians-mind-command-os/tree/bdd0c0204955b5446a5d0048d28c131969390bcd) | `bdd0c0204955b5446a5d0048d28c131969390bcd` | 5 |

The complete file intersections and migration names are in [c1-branch-overlap.json](evidence/c1-branch-overlap.json). File overlap establishes an integration obligation, not proof that the behaviors conflict.

## Required semantic reconciliation

1. **C4 message rendering and assets.** Both branches add `src/components/mind/message-rendering.test.ts`. C1 mounts real React components and measures historical parsing/current callbacks and visible-Data serialization. The inspected C4 file uses its own renderer fixture for 20/200/1000-message histories, changed links/current image callbacks and missing attachment labels. Rename/preserve both suites; do not choose one side of this add/add conflict and discard the other. C4 adds account-attachment storage and model execution records; reconcile its asset availability with C1 owner-only blob access, original-file checksums, PDF evidence, lineage and portable export manifest. C1's stated local-asset limits must be updated only if the integrated account-storage path actually proves a stronger guarantee.

2. **C2 connector and execution recovery.** Shared files include durable OAuth, provider refresh/store, Notion, turn/stream, agent/worker, privacy/workspace, voice and normal test discovery. Preserve C1 grant-generation/verified-subject CAS, resource-specific permission status, fresh append confirmation and exact saved workspace. C2's inspected migration adds `mind_notion_operation`, `mind_oauth_recovery`, `mind_oauth_refresh_claim`, `mind_execution_receipt` and rate windows. These are distinct from C1's `mind_notion_operation_status` and resource/media receipt tables. Consolidate their state semantics and same-operation recovery; never let a second ledger or alternate route authorize duplicate dispatch, stale approval or a different workspace.

3. **C5 usage and execution authority.** C5 adds `mind_usage_ledger` and changes provider calls, turn handling, halt, Fleet, voice, PC, Build and connector files also changed here. Reconcile C1 reserve→dispatch→settle authority with the integrated usage ledger so each actual call is reserved and settled once. Keep reported usage, estimates and unknown cost separate. Preserve finite-token-cap rejection for opaque routes, owner CAS, explicit helper authorization and no implicit paid fallback. This is a required combined test, not a claim that the inspected C5 branch currently double-counts.

4. **C3 native boundary.** The inspected C3 native branch shares only `package.json`, `command-app.tsx`, `turn.server.ts`, `routeTree.gen.ts` and `api/mind/pc/status.ts` with C1. Keep the website's durable coordination/capability manifests/origin rules compatible with the companion protocol. Native packaging/device verification stays separately versioned and authorized.

5. **Migrations and test discovery.** C1 has 0017–0021; C4 has 0017/0018, C2 has 0018/0019 and C5 has 0020 with distinct full filenames. The migration ledger keys full basenames; overlapping numeric prefixes are not evidence that migrations are duplicates. Review combined ordering and schema meaning, update the exact migration-plan inventory, and extend the real pre-audit upgrade fixture to the combined set. Never rename an already deployed migration. Preserve complete `.test.ts`/`.test.mjs` discovery, private test directories, deterministic provider transports and the four explicitly reported absent optional OG-skill tests.

## Shared high-impact paths

`command-app.tsx`, `types.ts`, `workspace.ts`, `use-mind-workspace.ts`, `workspace-edits.ts`, `server.ts`, `turn.server.ts`, `provider-call.ts`, `model-consult.ts`, `connected-mcp.server.ts`, `custom-connection.ts`, `halt.server.ts`, `fleet.ts`, `voice/http.server.ts`, `pc-pairing/store.ts`, Build/Kimi handlers and `package.json` require behavior review even where Git merges without conflict. Regenerate the route tree after route reconciliation.

## Integration gate

Keep C1's 114 finding records and distinguish original proposals from delivered scope. Run both branches' distinct owner/session, grant/tool definition, stale revision, receipt replay, privacy revocation, budgeting, cancellation, asset and render regressions on one combined branch. Repeat the affected synthetic browser journeys and collect new exact-revision evidence. The C1 clean-source reports become historical when integration changes code; do not reuse their SHA as proof for the consolidated candidate.
