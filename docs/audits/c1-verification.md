# C1 verification and release-evidence implementation

Audit: **Notion Access Audit**, chapter `4231aa2763238138937ec5a478120d17`. Original: [C1/M20](https://app.notion.com/p/4231aa276323815eb1e9c95087daece4). Base: `18d5b9364e6bdcfec028eeccf56fe596946ed8ce`. Changes are on the isolated audit branch; no deployment is claimed.

Final browser verification used the **clean committed implementation** [`b17e90c5728f7f1a9f303f703fcf073cbdd2175e`](https://github.com/emzylavish-art/adrians-mind-command-os/commit/b17e90c5728f7f1a9f303f703fcf073cbdd2175e). The retained [evidence packet](evidence/c1-local/README.md) contains the original reports, 30 successful screenshots, scoped environment record, and separately labeled earlier failures. This documentation/evidence update does not change the tested application or scripts.

| Finding | Status | Actual change and affected files | Regression and remaining acceptance |
|---|---|---|---|
| AA-098 Visual exit status | fixed and tested | `scripts/visual/policy.mjs`, `audit.mjs`, policy JSON: explicit report/release modes; axe/layout thresholds; exact-revision reviewed exceptions including affected targets; baseline regressions/resolutions; structural failures cannot be waived. | `policy.test.mjs`: report success is not release eligibility; changed target, revision or expiry invalidates exception; empty/dirty evidence blocks release. Final clean-source browser run has zero findings, failures, waivers or provenance errors across 14 captures. This passes the captured synthetic visual scope, not the separate production release gate. |
| AA-099 Destination verification | fixed and tested | `destinations.mjs` is used before actual runner screenshots; checks screen identity plus ready heading/content and actual theme. | Wrong-destination rejection is covered in the real verifier's fixture. Actual Chromium reaches and verifies all 14 expected screen/state combinations before capture. |
| AA-100 Deterministic states | fixed and tested for the implemented catalog | `fixture-states.mjs` is invoked by the runner. Seven states cover Plugins, Build, Settings, Chat, and Agents. All API/RPC calls are fulfilled/refused, other origins/WebSockets/service workers blocked, and each state gets fresh synthetic storage. `transition-fixtures.mjs` adds eleven actual UI transitions with controlled stream/video receipts. | Normal Node tests prove transport refusal and actual routing installation. Chromium passes 14/14 catalog states plus 11/11 listed transitions. Voice module loading is verified; live speech, Research, further Media scenarios and physical-device behavior are not inferred from these cases. |
| AA-101 Environment matrix | fixed and tested for record/validation; physical verification blocked | Environment JSON and validator distinguish source, unit, Chromium, authenticated preview/production, and physical iOS/Windows/Android. Physical proof requires device/runtime identity. | Tests refuse emulation as physical proof, missing authentication and future dates. All physical records are unverified. Next: authorized device runs with exact revision and artifacts. |
| AA-102 Revision-specific completion | fixed and tested | Feature matrix, JSON inventory and historical archive cover every prior row. Older passed proof becomes historical on a new candidate; no invented verification SHA. | Tests cover current proof, changed-SHA historical classification, missing evidence rejection, unverified checked-in inventory. CLI consistency passed; it does not establish feature completion. |
| AA-103 CI/deployment linking | fixed and tested for validator; release verification blocked | Evidence validator/CLI/template require exact CI/build revision, artifact digest, database environment/migrations, deployment/alias, signed-in/out journeys and distinct compatible rollback. No workflow changed. | Synthetic consistent release passes; wrong SHA, skipped/duplicate check, different artifact/alias/database, canceled journey, missing authentication/rollback/environment fail. Unverified template intentionally fails. Retrieve real final-candidate evidence before release claims. |

## Executed checks

```text
node --experimental-strip-types --test --test-concurrency=1 \
  scripts/visual/policy.test.mjs \
  scripts/visual/fixture-states.test.mjs \
  scripts/verification/evidence.test.mjs \
  src/lib/mind/kimi/hosted/resource-dispatch.test.ts
PASS: 11 tests, 0 failed, 0 skipped, 0 canceled.

node --check scripts/visual/audit.mjs
node --check scripts/visual/fixture-states.mjs
node --check scripts/verification/validate.mjs
PASS: JavaScript syntax.

node scripts/verification/validate.mjs --features docs/verification/feature-evidence.json --revision 18d5b9364e6bdcfec028eeccf56fe596946ed8ce
PASS: record consistency; all product features remain explicitly unverified.
```

The parent-owned normal test runner discovers these `.test.mjs`/`.test.ts` files. The command above is the actual targeted evidence, not a claim that combined tests/typecheck/build passed. Final full-suite/typecheck/build results belong in the parent implementation checklist.

## Actual browser verification

The default Playwright browser was absent, but an existing cached Chromium executable was found and used without installing software. The actual reported version is **153.0.8010.0**. Vite and Chromium ran as sibling processes on `http://127.0.0.1:4199`, with isolated temporary storage, fixture identity, no provider/database credentials, and intercepted browser API/RPC/external traffic. Both processes were stopped after each run.

| Check | Exact result on clean `b17e90c…` | Retained evidence |
|---|---|---|
| Seven states × desktop 1440×1000 / mobile 390×844 | **14/14 passed**; zero axe violations at any severity, document overflow, overflowing controls or small targets; no exceptions. Recorded `2026-11-26T03:42:46.797Z`. | [report.json](evidence/c1-local/report.json) |
| Actual UI transitions | **11/11 passed**, zero failures. Recorded `2026-11-26T03:44:44.359Z`. | [transitions.json](evidence/c1-local/transitions.json) |
| Auth build/dev invariant | **Passed after both runs**: sign-in off agrees with the explicitly disabled local build flag. | Reproduction command below; this is configuration consistency, not signed-in account proof. |
| Environment-record consistency | Browser evidence is scoped to this exact implementation SHA; physical/authenticated/live-provider environments remain unverified. | [environment-evidence.json](evidence/c1-local/environment-evidence.json) |

The eleven transitions verify: a 180-message conversation's wheel-scrolled position through A→B→A; loading 80 older messages and revealing/focusing the oldest; synthetic streaming becoming Markdown while following the tail; unsaved TypeScript symbol selection and same-workspace dependency opening; mobile drawer current state, focus trapping and Escape; persisted light/dark themes; long Settings→short Projects→Settings scroll restoration to **exactly 1600 px** after asynchronous content settles; reduced-motion and desktop-resize modal cleanup; lazy Build/Voice Studio rendering; delayed/rejected video start; and accepted video status recovery using one request ID with no second start.

For video, the controlled start stays pending for 5.5 seconds on a synthetic clock. The UI shows Submitting, with no accepted/rendering wording or status polling. A rejected start produces no status request; an accepted start produces exactly one status request with the same operation/request identity, then a synthetic completion. The returned video URL is deliberately blocked and does not prove playback, retained bytes, or a real provider response.

```bash
# Preview and browser must share one network namespace. Use an isolated preview and an existing browser binary.
BASE_URL=http://127.0.0.1:4199 BROWSER_EXECUTABLE_PATH=/path/to/chromium VISUAL_ARTIFACT_DIR=/path/to/scratch-evidence node scripts/visual/audit.mjs --fixture-only
BASE_URL=http://127.0.0.1:4199 BROWSER_EXECUTABLE_PATH=/path/to/chromium VISUAL_ARTIFACT_DIR=/path/to/scratch-evidence node scripts/visual/transition-fixtures.mjs
node scripts/check-auth-invariant.mjs --dev-url http://127.0.0.1:4199
```

Earlier actual browser failures drove corrections: invalid Build ARIA patterns/small controls, transient Save-button contrast, Chat reading/tail state, page-scroll clamping during asynchronous layout, and video progress hidden inside the message queue. The final reruns pass without waivers. Test readiness was also corrected to await client-only synthetic content, and the drawer test accurately treats the legacy bottom navigation as hidden by the existing shell. Earlier failures are not promoted to the committed build; the retained historical record is explicitly marked dirty.

No authenticated real account, live provider, deployment, rollback or physical-device test occurred. Repeat affected checks after integration and populate release records only after separately authorized verification.

## Integration

AA-097 discovery belongs to the parent lane. Fixture expectations depend on current Build section/panel names, owner-scoped workspace keys, resource-policy response and connector status shape; combine them with those fixes. Validators check evidence consistency; they do not fetch or authenticate referenced external artifacts. No competing test framework or service was added.

## Integration regression cleanup

The parent’s combined discovery run exposed three existing test integration mismatches. Updated migration inventory now includes 0017–0021; the Supabase callback’s static redirect helper uses an explicit `.ts` import for native Node (public callback API unchanged); the failure-host test follows the shared Notion routing seam and exercises timeout copy with fresh write approval. The legacy Notion retry expectation no longer preserves `confirmed:true`. The introduced MCP test `prefer-const` issue was fixed without changing its assertion behavior.

Executed normal Node test command with a private scratch `TMPDIR`: `scripts/migration-plan.test.mjs`, `src/lib/supabase/callback-redirect.test.ts`, `src/components/mind/surface-failure-host.test.ts`, and `src/lib/mind/notion-failure-action.test.ts` — **PASS 28/28**, zero failures/skips/cancellations. This is targeted integration evidence, not a live OAuth exchange.
