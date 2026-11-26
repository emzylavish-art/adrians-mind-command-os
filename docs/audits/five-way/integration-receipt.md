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
