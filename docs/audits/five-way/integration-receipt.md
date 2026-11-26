# Five-branch integration verification

The integration is open in [PR #68](https://github.com/emzylavish-art/adrians-mind-command-os/pull/68). The production alias resolved to READY deployment `dpl_DuhZnd7cmvzrL4NiJrd5ZazfoG15` at `18d5b9364e6bdcfec028eeccf56fe596946ed8ce`. This is the previous release. The integration has no production migration or promotion receipt.

| Chapter | Published website input | Source findings |
| --- | --- | ---: |
| C1 | 718114ec44a8df3420b95e0c6231cf0599baf829 | 114 |
| C2 | 5aa2c2c909278fae9b2af3a4861520c0e3feed66 | 136 |
| C3 | 675a1588a681c5cc1887ea17bb397f35eab1787b | 256 including 20 native |
| C4 | 217d95b453e79c25de6cc43a4adfffb0c387695d | 66 |
| C5 | a9e198dda212e95d4384f31faa64cb60ff49f17a | 46 including earlier overlapping scenarios |

The [coverage receipt](coverage.json) identifies the five chapter indexes, all 137 records and each handoff end marker. 136 records contain readable source material. C3 Pass 1 and C4 Pass 5 rely on cumulative material. C5 M05 contains the omission notice and M06 is cumulative. The [record index](original-record-index.json) identifies literal finding IDs in each retrieved record, including repeated mentions. The [C1](C1.json), [C2](C2.json), [C3](C3.json), [C4](C4.json) and [C5](C5.json) ledgers distinguish branch verification from combined evidence. Pending findings require further review and verification. Native PR #65 remains separate.

## Reproduced checkpoints

| Git revision | Combined evidence |
| --- | --- |
| a686e2f624ba58408e5448c26fa55483c3b6ba77 | Reconciled Notion page selection, readback, owner/grant checks, shared rate limits, and discovery/shard execution. Chromium used a clean local commit with the identical published tree 3d587581130433d9c8adf405954ac78da345f23b. [CI](https://github.com/emzylavish-art/adrians-mind-command-os/actions/runs/45830282966) |
| 0c036a2b097f8b1d6a7dd149d3a6358e10ff4661 | Restored per-turn helper consent, provider model compatibility and owner-bound response recovery. The full local discovery runner executed 3,093 tests with 2,906 passes, 182 failures and five skips. Baseline full lint had 177 errors and 215 warnings. This revision had 172 errors and 557 warnings. The two totals alone cannot identify newly introduced violations. [CI](https://github.com/emzylavish-art/adrians-mind-command-os/actions/runs/45833003186) |
| d60778b5cf3192ec511d7d8044521ff47bf20a1d | Reconciled provider account switching and fleet operation recovery. The full local discovery runner executed 3,095 tests with 2,915 passes, 175 failures and five skips. No canceled tests. TypeScript reported 89 diagnostics. Actual CI passed build, migration rehearsal, interface inventory and policy checks. Script tests, TypeScript and all four unit shards failed. [Failure list](evidence/d60778b-failures.json) · [CI](https://github.com/emzylavish-art/adrians-mind-command-os/actions/runs/45834221164) |

The 86-test fixture run on the tree of d60778b passed without failures or skips. Command from the repository root in Bash:

```sh
NODE_ENV=test node --test --test-concurrency=2 src/lib/mind/{limits,c1-durable-runtime,execution-evidence,failure-envelope,stream-integrity,c2-model-provider-contract,memory-send-preparation,model-consult,consult-selection,fleet-model}.test.ts
```

All three Chromium checkpoints completed all 16 viewport/history cases. At d60778b, five met the proposed LCP target, four met the CLS target and three met the observed-interaction target. Results include 2,000-message histories and 200% text size. The fixture runs with sign-in disabled, makes no paid calls and provides no physical-device evidence. The artifact records individual timings, exact revisions, screenshot routes and content hashes. [Browser measurements and screenshots](evidence/browser-fixtures.json)

## Database and rollback

The upgrade retains all 17 added top-level SQL filenames. The deployed base has 14 top-level SQL files. No existing file is superseded. The rehearsal checks lexicographic execution including the distinct 0019 → 0021 financial-policy and 0020 → 0022 media dependencies. The candidate also adds a pinned checkout of the previous production app to the PostgreSQL 17 rehearsal. It builds the original name-only migration ledger, compares historical SQL bytes, and exercises the old store on both sides of the upgrade. A passing run of this strengthened job is required.

Before production SQL, verify the owner’s database/project identity and capture the migration inventory, checksums, a recoverable backup ID and a successful isolated restore. Record the old alias target, database restore point, row counts for owner data and backup scope without exporting user content into Git. From a clean checkout of the tested SHA, use the explicit release preparation command with its revision-specific evidence and retain the successful migration receipt. Vercel build executes separately.

If promotion fails after compatible SQL, leave the additive schema and new operation, usage and attachment records in place. If a promoted build must be rolled back, first quiesce mutating requests and workers and preserve a second restore point covering all intervening writes. Verify that old readers can safely handle the affected workspace records before restoring access to the previous deployment. Recover incompatible snapshots in a separate restored database and merge by owner, revision, operation and tombstone. A point-in-time restoration over live user data would lose new writes. The previous snapshot smoke check alone does not authorize that restoration.

## Remaining release gates

Resolve the exact-head failures and rerun the complete pipeline. Exercise production-equivalent permission, reconnect, account-switch and scheduler scenarios with an approved staging account and isolated destinations. Check current production Git integration settings before deciding whether the merge itself creates the one production deployment. Record backup/restore and migration receipts before promotion. No approved staging identity, real delivery destination, verified paid invoice, physical-device result or production backup receipt has been established in this session.

### Provider, image accounting, persona and Dashboard reconciliation

Local fixture command on the application tree in this change:

```sh
node --experimental-strip-types --test src/lib/mind/{personas/selection,provider-receipt,usage-ledger,consultation-failure,media/spend-ledger,c2-model-provider-contract}.test.ts src/components/mind/dashboard-3d/c2-dashboard-recovery.test.ts
```

58 passed, 0 failed, 0 skipped. Coverage includes an already-completed helper followed by primary rejection, request and response IDs for buffered providers, loopback versus hosted execution, partial token counts, distinct operation stages, account-bound persona identity, and Dashboard filter/detail continuity. A separate image test exercised generation, edits and failed/uncertain provider responses with synthetic bytes. The Build portion of that test file still failed to load its runtime fixture. No paid provider or live owner data was used.

Previous exact remote head `6cce23ec9dc956b059214d543ae9996e30c31653` ran 3,095 tests locally: 2,918 passed, 172 failed, 5 skipped. The PostgreSQL 17 CI rehearsal passed at that head. This branch remains held for full combined and staging verification.

### Archive, connections, research, scheduling and recorded voice

- Exact previous head `af2bc424709e2a8574e743e598cf0f850abb8958` ran 3,096 local tests: 2,938 passed, 153 failed and five skipped. [Failed test inventory](evidence/af2bc42-failures.json). CI passed the production build, interface inventory, PostgreSQL rehearsal and policy checks. [Production verification](https://github.com/emzylavish-art/adrians-mind-command-os/actions/runs/45839455362).
- An isolated Chromium rerun on that exact head completed all 16 layout cases. The first attempt with a shared dependency cache failed to load a dynamic module at the narrow viewport. With a separate cache, LCP met 2,500 ms in 4/16, CLS met 0.1 in 4/16 and observed interaction met 200 ms in 3/16. [Per-case report](evidence/af2bc42-visual.json) and [390 × 844, 2,000-message chat](evidence/af2bc42-chromium-390x844-100-2000-turns.png).
- This change ties archived chat memory to reviewed settings, preserves newer records, validates discovery updates against the saved account, and keeps the reported provider response ID distinct from its request ID. Research retains the selected eight citations as well as evidence from other queries. Scheduler claims use the selected execution environment. These changes have no live provider or terminal delivery receipt.
- Named transcription alternates run only after an eligible primary rejection. Whole-operation dispatch evidence survives fallback rejection. Voice fixtures exercise a lost provider acknowledgment, an unavailable initial journal and a failed final journal. The exact provider, monetary reservation and usage observation are tested with synthetic inputs.

Local checks for this application change: TypeScript exited successfully. The following focused run passed 151 tests with zero failures or skips.

```sh
node --experimental-strip-types --test src/lib/mind/{archive-review,audit-connection-integrity,custom-connection,connected-mcp,media/history-audit,kimi/hosted-files,provider-catalog,store,research,research-audit-recovery,research-reports,c1-research-skills,xai-search,mcp-selected,voice/usage,voice/http-budget,voice/explicit-provider,voice/transcription-policy,whisper-flow/provider}.test.ts
```

Deployment remains held. Scheduled run permissions, stale workspace handling, browser performance, authenticated staging and backup/restore verification still require evidence.

### Full-suite checkpoint at 4f539b105c306195ae7350ee6aea2f92da31a52e

The exact remote tree was c6a8d155d6164096dd345e66ea094cbf3ca486ec. GitHub CI 45842423358 passed typecheck, production build, interface inventory and PostgreSQL migration rehearsal. Scripts and unit shards failed. The separate policy run 45842423321 passed. Local full discovery ran 3,097 tests, with 2,969 passes, 123 failures and five skips. Full lint reported 172 errors and 528 warnings, against 177 errors and 215 warnings on main. The file-level diagnostic differences, complete failure inventory, exact-head browser report and redacted portrait capture are under evidence/4f539b1*. Chromium layout passed 16/16. LCP, CLS and interaction targets passed 9/16, 4/16 and 4/16. The physical-device and authenticated production-equivalent gates remain open.

### Workspace and document reconciliation

The workspace hook now suspends account loads until authentication resolves, merges edits typed during an initial server read and applies cross-tab creates, renames and deletes against the last browser checkpoint. Incremental saves preserve recovery records, file tombstones, conflicts and tool permissions. Image uploads use the original account, including device-only bytes after local compaction. An unavailable device reference stops the account save. PDF preview evidence continues to use its historical exact offsets and digest. The separate bounded full extraction preserves page/line breaks and searchable passages after the preview. The Library saves these with the owner-scoped original.

Local command: `node --test src/lib/mind/{workspace-changes,workspace-hook-lifecycle,pdf-text,pdf-text-audit,library-documents,media/attachment-integrity}.test.ts`. All 32 cases passed with zero skips. These results use synthetic workspaces, PDFs, storage, and server calls. The previous authenticated staging and production release gates still apply.

### Chat and Speak recovery checkpoint

The preceding PR head 6ec597bcca285862ed47110c1b39a55c134b6fa8 (tree c6bcc98b5a692ab2971ecc0592b9f0ade65ea63a) passed CI typecheck, build, interface inventory and PostgreSQL rehearsal. Script tests and all four unit shards failed. See GitHub Actions run 45844126888 and policy run 45844127317. Local discovery reported 3,100 tests, 2,981 passes, 114 failures and five skips. The complete failure list is in evidence/6ec597b-failures.json. Full lint had 172 errors and 507 warnings against 177 errors and 215 warnings on main. The exact-head Chromium fixture passed 16/16 layouts. LCP, CLS and interaction passed 6/16, 4/16 and 4/16. Its measurements and redacted screenshot are in evidence/6ec597b*.

On the subsequent tree, saved chat retries check the original owner's receipt for an uncertain dispatch. They retain interrupted stream text in one checkpoint and replace it on completion. Explicit preflight rejection uses separate recovery. Recorded voice follows the selected answer provider, exposes the actual answer receipt and supports local browser output with late mute and cancellation. The fixture runs the mounted handlers with controlled HTTP, audio and owner transitions. It also rechecks saved memory after a policy change during preparation. Its project-memory fixture includes a real owner-scoped project record and separately checks revocation when that project is removed.

Local validation ran the two adrian-audit deliver and Speak lifecycle script suites and src/lib/mind/{live-turn,turn-receipt,voice/speak-action,voice/provider-selection,voice/stage-receipts,voice/speak-output-contract,voice/speak-e2e,voice/speak-queue-regression}.test.ts with node --test. All 54 passed with zero skips. The six memory/dispatch-policy.test.ts cases also passed. Provider failures, physical microphone and phone behavior, and cross-account authenticated staging require independent evidence.

### Selected providers, dispatch receipts and fleet execution

On PR head `70cded50c11e89fb2502c296346bae4e32777a51`, the full discovery run executed 3,100 cases. It recorded 2,987 passes, 108 failures and five skips. The [case inventory](evidence/70cded5-test-cases.json) records each case and source location. The [finding index](fixture-coverage.json) connects chapter and original record references to their associated suites. Chromium completed 16 geometry fixtures, with three meeting the LCP target, four the CLS target and two the interaction target. [Viewport measurements](evidence/70cded5-visual.json) and [390 by 844 screenshot](evidence/70cded5-chromium-390x844-100-2000-turns.png). GitHub [CI](https://github.com/emzylavish-art/adrians-mind-command-os/actions/runs/45846437019) passed typecheck, production build, interface checks and PostgreSQL rehearsal. Script tests and four unit shards failed. The unmodified production base passed 1,642 tests and skipped four.

The subsequent application changes recover saved responses by original owner and operation, preserve helper consent and reported usage, and prevent a second provider request after uncertain voice or answer dispatch. The fleet workbench keeps the local stop acknowledgment and external outcome independently. Queueing an unavailable capability, a mismatched approval or an unconfirmed destination cannot dispatch. Deleted projects, temporary chats and archived conversations stay outside eligible local tool reads. Explicit delegation remains subject to parent and child authorization. The five fleet and workbench suites passed 86 of 86 fixture tests. These receipts cover synthetic workers and local transports. Hosted scheduler delivery, actual provider billing, native termination and a restored production backup remain unverified.

### Search, account changes, Build and emergency stop

The preceding published commit `5556aeb9e47352b178393bacbe0ab17103102df9` executed 3,101 tests with 3,036 passes, 60 failures and five skips. The [failure and skip receipt](evidence/5556aeb-failures.json) identifies each by name and file. [CI](https://github.com/emzylavish-art/adrians-mind-command-os/actions/runs/45850441529) passed build, typecheck, interfaces and PostgreSQL 17 rehearsal. All four unit shards and the script job ran and failed. Policy CI passed. Lint reported 172 errors and 502 warnings. Chromium completed all 16 layout cases, with five meeting LCP, four CLS and three observed interaction targets. [Browser measurements](evidence/5556aeb-visual.json) and [390 by 844 screenshot](evidence/5556aeb-chromium-390x844-100-2000-turns.png).

The subsequent changes use canonical server identity, preserve the selected Settings pane and Intelligence thread in browser history, and attach Drive and local Library imports to the reviewed destination. Search reuses normalized history and exposes independent matching messages and exact record destinations. Twelve thousand message bodies were exercised in the index fixture. Browser keyboard pinning and queue removal share the visible actions. The background fleet worker operates reviewed run plans and no longer converts arbitrary queue titles into PC commands.

Build binds source hashes to the target computer and directory. Saving before execution requires a verified write. Hosted checks compare against disk and paired receipts describe the submitted revision. Runtime observation tracks the operation independently from billing. Account stop records both the account control and queued or running job outcomes; release requires the reviewed server revision. A newer stop wins over a pending release. The global stop covers all known jobs owned by the account, including shells. The narrower Build-only cancellation still leaves unrelated job kinds alone.

Fixture results on the subsequent tree included 27/27 across the client UI and voice/auth scripts, and 13/13 across Build and its source/stop lifecycle regressions. These counts describe the specified fixtures only. See full combined CI for broader acceptance.

## Account, archive and execution recovery

The [preceding head's 32 failed and five skipped cases](evidence/456562a-failures.json), [exact-head browser measurements](evidence/456562a-visual.json) and [portrait screenshot](evidence/456562a-chromium-390x844-100-2000-turns.png) are preserved. Full discovery at that head passed 3,064 of 3,101 tests. PostgreSQL, build, typecheck and interface checks passed in [CI](https://github.com/emzylavish-art/adrians-mind-command-os/actions/runs/45852633417).

The follow-up restores incremental upserts, scoped attachment deduplication and explicit archive restore, connects the Integrations page to observed account state, binds MCP review and draft recovery to the original chat, and requires verified sign-out before redirect. Model-specific media capability and the byte allowance both constrain historical images. Research failures retain the original operation in both mounted entry points and require review after an uncertain response. Hosted Build transmits the full versioned builder instruction once. These claims require verification against this revision and the remaining external release gates.
