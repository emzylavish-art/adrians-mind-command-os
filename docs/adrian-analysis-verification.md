# C4 implementation verification

**Base:** `18d5b9364e6bdcfec028eeccf56fe596946ed8ce`. **Branch:** `audit/adrian-analysis-66-1125`.

This record describes the local implementation checks. It does not claim that the branch is merged, deployed, or proven against a real account/provider/device. Remote GitHub checks are reported on the draft PR and in the final handoff. A targeted fixture pass does not turn an interrupted broad check into a pass.

## Passing checks

| Check | Observed result | Scope |
|---|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | Exit 0; 1,106 packages installed | Locked dependency installation; no lifecycle scripts or production migration |
| New voice/auth/Build/Library/navigation/scheduler/accessibility callbacks, plus existing sign-out fixtures | 58/58 passed | Actual extracted component callbacks and rendered/component contract fixtures; fake identities/services |
| `scripts/adrian-audit-deliver-lifecycle.test.mjs` | 11/11 passed | Actual delivery callback; current memory permission, owner/halt changes, receipt-only recovery, long partial/final text, dispatch accounting and selected-provider voice receipt |
| Root context/navigation/search/retry/limits/model-consult/logic-route batch | 55/55 passed, exit 0 | `adrian-analysis-regressions`, `app-location`, `limits`, `retry-fidelity`, `palette-label`, `model-consult`, `logic-routes` |
| `audit-connection-integrity.test.ts` | 8/8 passed, exit 0 | Notion accepted/unknown receipts, current integration status, MCP schema freshness and cancellation |
| Neighboring Notion/MCP/stream regression batch | 118/118 passed, exit 0 | Existing behavior around modified connection and transport paths |
| Final stream/relay receipt-contract batch | 59/59 passed, exit 0 | `stream`, `live-turn`, `stream-integrity`, `chip-sse-contract`, `relay`, `turn-timeouts`, `timeout-integration`; includes no primary dispatch for local responses and abort before relay fetch |
| `mcp-list-auth.test.ts` | 9/9 passed, exit 0 | Canonical verified identity; conflicting account IDs rejected even with matching emails |
| Persistence/reconciliation/attachment/hook batch | 31/31 passed | Owner-scoped state, safe merges, conflict/reload behavior and attachment portability fixtures |
| Provider/custom-provider/logic/model-consult/rendering batch | 40/40 passed | Receipt metadata on success/failure, preflight rejection, distinct helper executions, rendering |
| `persistence-incremental.test.ts` isolated rerun | 1/1 passed | Actual disposable PGlite: targeted writes, transaction rollback, CAS, account attachment isolation and idempotent helper receipts |
| `team/test_provider_router.py` | 13/13 passed | Python adapter metadata and error handling with fake responses |
| Final Build/editor/auth focused rerun | 21/21 passed | Includes actual CodeMirror EditorState/Compartment theme changes preserving dirty text and selection |
| Existing voice/auth focused checks | 24/24 passed | Neighboring compatibility |
| Existing halt/PC focused checks | 11/11 passed | Owner-scoped queued/running cancellation semantics |
| New typed test registration | All 10 new typed test files present in `npm test` | Script glob also discovers all five new audit callback fixture files; three existing omitted suites were registered |
| ESLint on every newly added TS/TSX/MJS file | Exit 0; 0 errors, 2 fixture-hook warnings | New files only; existing repository lint errors remain |
| `scripts/verify-xai.test.mjs` isolated rerun | 2/2 passed, exit 0 | Missing-key/local persistence paths; live provider disabled |
| `git diff --check` | Passed | No patch whitespace errors |

These groups overlap; their counts must not be summed into a unique-test total.

### Browser/geometry profiles

Actual local Chromium 153.0.8010.0 ran the real React DOM/message renderer against synthetic 20/200/1,000-message histories. Baseline source is the exact base above. During 20 live-text updates, block and Markdown parses dropped from 820/8,020/40,020 to 20 at each size. Every case retained the first historical node, selection, focus, scroll offset and access to the final message. All historical DOM remains mounted; variable-height virtualization was a conditional proposal and is not implemented.

The single 1,000-message development-fixture run measured total synchronous update commit time of 4,731.2 ms before and 173.1 ms after, and maximum individual commit of 507.1 ms before and 14.6 ms after. This is not production INP, a physical-device measurement or full-ChatPane latency.

Actual app CSS with representative markup passed time-zone field geometry at 320/768/1,280 CSS pixels with full values intact and no horizontal overflow. Editor chrome switched to the expected semantic light/dark colors. That CSS fixture does not mount CodeMirror; the separate actual EditorState fixture covers reconfiguration without losing edits/selection.

Reproduction scripts: `scripts/profile-c4-history.mjs`, `scripts/profile-c4-render-counts.mjs`, `scripts/profile-c4-layout.mjs`. Machine-readable results and exact limitations: [C4 evidence](audits/c4-evidence/README.md).

## Broad checks: failures and limits

- Latest full `npm test` script phase: **288 tests, 283 passed, 1 failed, 4 skipped**. The failure was the existing `verify-xai` missing-key child process exiting with no status during its isolated persistence check; no provider call was made. Its sibling passed in that run. An earlier attempt also exposed an outdated migration inventory; that test now includes both new migrations. The script failure prevents the chained typed phase, so the exact typed inventory was invoked separately. Both verify-xai cases subsequently passed in the isolated rerun; the all-in-one result remains recorded as failed.
- The separate complete typed inventory reported **1,487 tests, 1,480 passed, 7 failed**. Six were whole-file process failures in `audit-connection-integrity`, `gmail-oauth-status`, `oauth-security`, `providers-oauth`, `file-persist` and `persistence-incremental`. The remaining failure was a stale source assertion requiring the superseded Supabase-precedence auth helper. It was corrected to the canonical identity contract and its file passed 9/9. The two changed integrity/database files also passed isolated reruns. This record does not claim a subsequent clean all-in-one run.
- Full `npm run typecheck`, initial lint and migration-free `npm run build:dev` attempts were killed by the shared execution environment. A 768MB TypeScript attempt explicitly exhausted its heap; other invocations exited 137. The development build reached 2,649 client modules but did not complete. No incomplete build is a release artifact.
- A later bounded `npm run lint` completed with 183 errors and 224 warnings across the repository. Introduced errors were isolated and corrected; existing repository errors are not a passing lint gate. Final focused lint evidence is recorded with the branch handoff.
- A temporary native TypeScript cross-check (TypeScript 7 preview, with only obsolete `baseUrl` removed from a temporary config) completed once and identified eight diagnostics. Those diagnostics were fixed. Subsequent full native reruns were killed; this is not a clean typecheck claim. The normal TypeScript 5 repo command remains the required CI gate. The temporary config is not part of the patch.
- The shared `/tmp` tmpfs filled with test databases. Later fixtures used a dedicated workspace temporary directory. No other chat's temporary data was removed.
- `npm run check:auth` was **indeterminate** because no live local development server was running. It did not establish an authentication invariant pass or mismatch.
- The four script skips retain their existing opt-in/environment gates. No skip is counted as live verification.

## Release/integration checks still required

Run the normal typecheck, complete script/typed suites, lint, migration-free or disposable-database build and auth invariant on the final integrated code. Apply `0017_c4_account_attachments.sql` and `0018_c4_model_execution_receipts.sql` only through the later authorized release process, after reconciling migration numbers with other audit branches. No production migration ran here.

Real authenticated reconnect/session switching, live provider receipt matching, cross-device attachment hydration, physical microphone/speaker behavior, screen-reader use and production/mobile layout remain separate authorized release checks. AA-037 verified per-model capacity and AA-045 lifetime accounting retention remain explicit decisions in the [finding checklist](adrian-analysis-implementation-checklist.md).
