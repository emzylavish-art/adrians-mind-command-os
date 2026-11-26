# C4 persistence, provider receipts, and rendering evidence

This evidence accompanies the Adrian Analysis C4 implementation branch. The baseline used by the rendering comparison is `18d5b9364e6bdcfec028eeccf56fe596946ed8ce`. It is repository evidence, not proof of a production release. No real account, provider, production database, or physical device was used.

## Controlled regression coverage

| Finding | Implementation boundary | Executable evidence |
| --- | --- | --- |
| AA027 | Refresh, compare, and CAS on Retry save; bounded conflict retry; explicit conflicting-field choice bound to reviewed revision | `workspace-reconciliation.test.ts` |
| AA028 | Retained per-owner server comparison base; unknown base cannot silently replace a divergent server copy; input arriving during initial load retained | `workspace-reconciliation.test.ts`, `workspace-hook-lifecycle.test.ts` |
| AA029 | Whole-workspace reconciliation from storage events, including creation, rename, and deletion | `workspace-hook-lifecycle.test.ts` |
| AA030 | Per-field record merge, per-message transcript merge, explicit cross-device deletion/edit conflict | `workspace-reconciliation.test.ts` |
| AA031 | Separate authenticated, owner-scoped attachment bytes with verified write receipt and second-device retrieval; local bytes retained on failure | `media/attachment-integrity.test.ts`, `persistence-incremental.test.ts` |
| AA032 | Preserve bytes past the former 1,500,000-character normalization boundary; reject unsupported oversized saves before normalization | `media/attachment-integrity.test.ts` |
| AA033 | Missing-image text says unavailable and requests reattachment | `components/mind/message-rendering.test.ts`; parent implementation adds send/context warning |
| AA034 | Export/import attachment manifest distinguishes integrity hash from completeness and recomputes external claims | `media/attachment-integrity.test.ts` |
| AA035 | Legacy image fallback requires validated original-owner references; scoped write commits before legacy deletion | `media/attachment-integrity.test.ts` |
| AA043/044 | Normalize available reported usage, request IDs, actual/requested model, local/hosted execution; keep error metadata; no provider execution recorded for proven preflight rejection | `provider-receipt.test.ts`, `custom-provider-receipt.test.ts`, `team/test_provider_router.py` |
| AA046 | Individual helper identities, independent failure/unknown outcomes, idempotent owner-scoped receipt persistence | `provider-receipt.test.ts`, `persistence-incremental.test.ts`; parent implementation transports and records the receipts |
| AA058 contribution | Actual workspace hook performs no guest read/save/init during pending authentication | `workspace-hook-lifecycle.test.ts` |
| AA062/063 | Memoized historical text/body/links; image handlers still update when image controls can use them; unchanged history does not reparse on streaming parent updates | `components/mind/message-rendering.test.ts`, rendering profiles below |
| AA065 | Incremental row writes with owner isolation, existing transaction and CAS; snapshot failure rolls back prior row changes | `persistence-incremental.test.ts`, existing `store.test.ts` |

TypeScript test names without a prefix are under `src/lib/mind/`. Component tests are under `src/`. The hook fixture evaluates the actual hook source in a deterministic hooks host with fake storage and transport. The persistence fixture runs the actual SQL against an isolated, disposable PGlite database. Neither substitutes for a live deployment test.

Migrations `0017_c4_account_attachments.sql` and `0018_c4_model_execution_receipts.sql` were exercised only in that isolated database. Apply them through the approved release process before enabling the corresponding deployed paths. Account image storage uses the existing configured database; no paid storage service was added. Attachment/receipt retention and orphan cleanup are not a new billing-retention product or a lifetime accounting guarantee.

## Rendering comparison

`render-counts.json` records the actual baseline and candidate TSX in the deterministic hooks/reconciliation fixture. `react-dom-profile.json` records the same cases in actual React DOM and Chromium 153.0.8010.0 on this workspace. The browser fixture deliberately recreates image callback identities on each parent render, retains every historical message, and performs 20 synchronous streaming-text updates.

| Historical messages | Baseline block parses during updates | Candidate block parses during updates | Baseline Markdown parses during updates | Candidate Markdown parses during updates |
| --- | ---: | ---: | ---: | ---: |
| 20 | 820 | 20 | 820 | 20 |
| 200 | 8,020 | 20 | 8,020 | 20 |
| 1,000 | 40,020 | 20 | 40,020 | 20 |

The 20 remaining parses belong to the changing live response. Initial mount parsing remains proportional to transcript size. The browser checks also retained the first historical DOM node, code selection, focus, reading offset, and access to the last historical message.

The recorded synchronous commit timings are diagnostic measurements from one development fixture on shared infrastructure. They are not production INP, frame rate, typing latency, full-ChatPane profiling, or device benchmarks. All historical DOM remains mounted. Variable-height virtualization remains a separate proposal that needs representative full-application measurements and search/selection/accessibility design; this patch does not claim to implement it.

Reproduce source-call counts with:

```sh
node scripts/profile-c4-render-counts.mjs 18d5b9364e6bdcfec028eeccf56fe596946ed8ce
```

Reproduce the real React DOM profile with an installed, runnable Chromium:

```sh
CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/profile-c4-history.mjs 18d5b9364e6bdcfec028eeccf56fe596946ed8ce
```

`CHROMIUM_ARGS_JSON` optionally accepts required local browser arguments. In this workspace, `/usr/bin/chromium` was only a launcher with no installed target. A pre-existing runtime Chromium package was reused without modifying that package. Initial extraction to a full `/tmp` produced failed launches; extraction with `TMPDIR` under workspace scratch and disabling GPU completed all six browser cases. Those failed attempts are not recorded as passing checks.

## Schedule and editor-chrome fixture

`layout-profile.json` and `scripts/profile-c4-layout.mjs` use the actual `gpt-shell.css` and application theme tokens, with representative schedule/editor-chrome markup and explicitly reproduced sizing utilities. They verify time-zone geometry at 320, 768, and 1280 CSS pixels, preserve the complete input value, and record computed chrome colors. They do not mount the full application or CodeMirror and do not establish physical-device behavior. Consult the JSON for the exact measured candidate state.
