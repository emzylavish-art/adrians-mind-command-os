# C3 local browser verification

These recorded fixtures verify the website's responsive controls, native modal focus, cross-surface scroll restoration, bounded transcript rendering and hydrated skill receipts against the source fingerprints below. **The latest final-source run passed all four viewport cases and all four navigation/modal groups, with no failures.** It includes three instruction receipts and one unavailable dependency after the completed AA-106 and AA-191 changes. Across the historical and final runs, all 28 recorded transcript/layout cases passed; they are not 28 cases at one source revision. **The proposed performance targets did not all pass.**

## Environment and exact source

- Audit chapter: Continue Production Audit / C3, Notion chapter `4231aa276323819f92ece254a4708b65`.
- Branch at execution: `audit/continue-production-c3-20261125-659f`.
- Git HEAD/base at execution: `18d5b9364e6bdcfec028eeccf56fe596946ed8ce`. Implementation edits were uncommitted then; this base SHA alone does not identify the tested implementation.
- Browser actually executed: headless Chromium **153.0.8010.0**. WebKit was not run.
- Local Vite development preview: `http://127.0.0.1:4195`; synthetic `dev-user`; reduced-motion preference; fresh disposable local database directory for each run; no credentials or remote database URL supplied.
- Runtime source fingerprint covers sorted tracked and untracked source, script, migration, package and Vite files selected by `sourceDigest()` in `scripts/visual/chat-layout.mjs`; test files are excluded. The historical runs each covered 914 selected files; the latest final-source run covered 924. Each run had a stable start/end fingerprint. The report also records the tracked-diff hash.
- Parent and sibling agents held runtime edits and heavy verification processes during these final successful runs. The timings remain local development measurements, not controlled production benchmarks.

| Run | Source SHA-256 | Transcript/layout cases | Navigation/modal groups | Failures |
| --- | --- | ---: | ---: | ---: |
| [Unavailable services](unavailable-report.json) | `1565274d6f8cbccd6acab8d044b3c6f3081e63b850b5c21c13f97bbbb6bebef4` | 16 | 4 | 0 |
| [Empty MCP registry; other services unavailable](empty-mcp-report.json) | `1565274d6f8cbccd6acab8d044b3c6f3081e63b850b5c21c13f97bbbb6bebef4` | 4 | 4 | 0 |
| [Focused final gutter correction](focused-gutters-report.json) | `d571ec9d868331dbbd7945f17193714349b044ff13e5cb10a6cb6c8f69580025` | 4 | 4 | 0 |
| [Latest integrated source, with hydrated skill receipts](final-integrated-report.json) | `edf69eaabda0fbfe434629d43625563f7471ad1c3c534a8f29f41a70b8717a91` | 4 | 4 | 0 |

The final focused correction fixes decorative sidebar gutters at 12px while permitting the selected text scale to enlarge labels. The fixture also restores the header's horizontal scroll after checking every action, so screenshots show its initial position. Full 16-state coverage was not rerun after this narrow correction. The first three reports predate the final AA-106 skill-receipt and AA-191 model-catalogue changes. The latest integrated report includes those completed changes, the paired Build receipt correction and the prepared skill-receipt browser assertions. It started at `2026-11-26T05:24:17.662Z` after the parent completed heavy verification, and its 924-file fingerprint stayed unchanged. Full integrated test, typecheck and build details belong in the branch verification record; the browser still used a local development preview.

## Reproduce the recorded runs

Run from the repository root. These are the exact environment values used in this workspace; a later environment must substitute its own installed Chromium path and writable artifact directory. The runner rejects non-local preview origins, validates the local authentication invariant, intercepts browser API/server-function requests and cleans up its disposable database.

```sh
TMPDIR=/workspace/scratch/659f1d0aea7c/test-tmp \
BROWSER_EXECUTABLE_PATH=/workspace/scratch/e328d67f7faf/chromium-tmp/chromium \
VISUAL_ARTIFACT_DIR=/workspace/scratch/659f1d0aea7c/visual-c3-final-unavailable-v3 \
node scripts/visual/run-c3-fixture.mjs

TMPDIR=/workspace/scratch/659f1d0aea7c/test-tmp \
BROWSER_EXECUTABLE_PATH=/workspace/scratch/e328d67f7faf/chromium-tmp/chromium \
FIXTURE_COUNTS=50 FIXTURE_SERVICE_STATE=empty-mcp \
VISUAL_ARTIFACT_DIR=/workspace/scratch/659f1d0aea7c/visual-c3-final-empty \
node scripts/visual/run-c3-fixture.mjs

TMPDIR=/workspace/scratch/659f1d0aea7c/test-tmp \
BROWSER_EXECUTABLE_PATH=/workspace/scratch/e328d67f7faf/chromium-tmp/chromium \
FIXTURE_COUNTS=50 FIXTURE_SERVICE_STATE=empty-mcp \
VISUAL_ARTIFACT_DIR=/workspace/scratch/659f1d0aea7c/visual-c3-final-gutters \
node scripts/visual/run-c3-fixture.mjs

TMPDIR=/workspace/scratch/659f1d0aea7c/test-tmp \
BROWSER_EXECUTABLE_PATH=/workspace/scratch/e328d67f7faf/chromium-tmp/chromium \
FIXTURE_COUNTS=50 FIXTURE_SERVICE_STATE=empty-mcp \
VISUAL_ARTIFACT_DIR=/workspace/scratch/659f1d0aea7c/visual-c3-final-integrated-skills \
node scripts/visual/run-c3-fixture.mjs
```

All four commands returned **exit 0**. The complete first matrix uses conversations with 1, 50, 500 and 2,000 messages (2,551 total), 300 projects, 300 files and deletion tombstones. Each matrix runs 390×844, 844×390 and 320×500 at 100% text, plus 1024×768 at the owner's persisted **200% text preference**. The three four-case runs each use the 50-message conversation with the same project/file inventory.

All external HTTP requests are aborted. In the unavailable-services fixture, local API and server-function requests return synthetic 503 responses. In the comparison fixture, only `GET /api/mind/mcp/servers` returns 200 with `{ "servers": [] }`; the other services still return 503. In particular, Notion status remains unavailable, and the screenshot's unknown-state warning is expected. This is not a connected or healthy integration account.

## Behavior verified

- The actual application hydrated and exposed `data-workspace-ready="true"` before interaction. The owner text-scale preference was loaded through application preferences, not injected after paint.
- Active transcripts initially render at most 100 messages. Loading an earlier page adds 100 messages for the large histories; it does not render all historical messages immediately.
- Draft editing, a 15-line draft, long attachment names, Send reachability, bounded attachment content, Home and Chat More menus, Chat settings Escape/focus restoration, every visible header action and Jump to latest passed the fixture's checks. Actions that need scrolling are explicitly scrolled into view and hit-tested.
- Mobile drawer focus stays inside the drawer; Escape restores the trigger. Resizing from mobile to desktop closes the drawer, releases its body scroll lock and restores visible sidebar focus.
- The shared Create project dialog enters native modal state, cycles Tab/Shift+Tab, rejects background focus, closes on Escape and restores the opener. The dialog was cancelled, not submitted. Earlier iterations reproduced Tab reaching the page body; the corrected shared focus boundary passed at all four viewports in all three retained runs.
- Projects → Library → Projects restored the exact **600px** scroll position in each navigation group.
- No unexpected page JavaScript errors were captured in the retained cases. Synthetic service errors remain visible as unavailable/unknown states.
- In the latest run, the last assistant message retained three `instructions_applied` receipts and one `dependency_unavailable` receipt after actual workspace hydration. The fixture clicked **Skills considered**, verified all four rendered rows, checked the recorded instruction checks, `Tools executed: none`, unverified task output and the client-selection caveat, captured the expanded disclosure, then closed it. These are explicitly synthetic stored receipts, not proof that a skill, model or external browser executed.

The shared modal unit suite also passes four new boundary/filter cases. Its combined drawer/visual contract group passed 16 tests with zero failures. The browser checks exercise one shared modal entry point; they do not independently prove every authenticated modal workflow or assistive technology.

## Measured performance, with unmet targets retained

The following thresholds are **proposed review targets**, not passing release gates: LCP ≤2,500ms, maximum observed interaction event ≤200ms and CLS ≤0.1. Parentheses show cases meeting that target.

| Run | LCP range (met) | Maximum observed interaction range (met) | CLS range (met) |
| --- | --- | --- | --- |
| Unavailable services | 404–3252 ms (4/16) | 152–304 ms (7/16) | 0.067–0.578 (4/16) |
| Empty MCP registry | 368–3340 ms (2/4) | 184–208 ms (3/4) | 0.065–0.576 (1/4) |
| Focused gutter check | 304–2952 ms (2/4) | 184–208 ms (3/4) | 0.065–0.576 (1/4) |
| Latest integrated source with skill receipts | 2424–3308 ms (1/4) | 56–184 ms (4/4) | 0.065–0.576 (1/4) |

LCP and layout shifts were captured with `PerformanceObserver`. CLS uses session windows; delayed service-error banners are present in these fixtures and contribute to movement. Interaction timing records event durations with an interaction ID and a 16ms reporting threshold; it is the slowest observed event, **not field INP**. `editMs` includes automation and six typed characters at a 15ms delay; it is not an INP substitute. The reports retain long-task counts/durations and Chromium's optional JavaScript heap estimate, which is neither total process memory nor a measured peak. The unavailable-service run observed 12–22 long tasks per sample and maximum individual tasks of 140–364ms. These misses remain visible for later performance work; they were not hidden by the behavioral pass/fail criteria.

## Selected screenshots and visual review

These five screenshots are from the latest integrated run at fingerprint `edf69eaabda0fbfe434629d43625563f7471ad1c3c534a8f29f41a70b8717a91`. They were inspected individually. Reachability uses center-point hit testing, not a guarantee that every button pixel is inside the screenshot. Compact/landscape and enlarged-text views use bounded scroll areas for the draft, attachment and header actions. At 200% text, long navigation labels can wrap, including mid-word where necessary; this establishes reachability and containment, not a claim that no typography refinement remains useful.

The portrait skill-receipt screenshot shows the expanded scrollable disclosure. Its viewport does not contain every receipt row simultaneously; the report's `skillReceiptReview` records the separate assertion of all four rendered rows after hydration.

| Viewport and owner text scale | Screenshot |
| --- | --- |
| 390×844, 100% | [Final portrait](final-chromium-390x844-100-50-turns.png) |
| 844×390, 100% | [Final landscape](final-chromium-844x390-100-50-turns.png) |
| 320×500, 100% | [Final compact](final-chromium-320x500-100-50-turns.png) |
| 1024×768, 200% | [Final enlarged text](final-chromium-1024x768-200-50-turns.png) |
| Expanded synthetic skill receipt, 390×844 | [Final skill receipt disclosure](final-chromium-390x844-100-50-skill-receipts.png) |

The older gutter-run PNGs and reports remain alongside these files as historical evidence.

## Evidence boundaries

No real account authentication, provider answer, external integration operation, production deployment, physical phone, physical keyboard, mobile software keyboard or screen reader was tested. No Send, provider generation, account connect/disconnect or external write action was invoked. These reports do not assert that any branch was pushed, merged, deployed, or promoted. The complete structured snapshot still loads as one unit; worker parsing, bounded transcript DOM and deferred historical media do not constitute backend pagination. Review the final integrated verification record for the exact pushed commit and whole-branch checks.
