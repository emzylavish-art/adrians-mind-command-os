# C1 verification and release-evidence implementation

Audit: **Notion Access Audit**, chapter `4231aa2763238138937ec5a478120d17`. Original: [C1/M20](https://app.notion.com/p/4231aa276323815eb1e9c95087daece4). Base: `18d5b9364e6bdcfec028eeccf56fe596946ed8ce`. Changes are on the isolated audit branch; no deployment is claimed.

| Finding | Status | Actual change and affected files | Regression and remaining acceptance |
|---|---|---|---|
| AA-098 Visual exit status | fixed and tested | `scripts/visual/policy.mjs`, `audit.mjs`, policy JSON: explicit report/release modes; axe/layout thresholds; exact-revision reviewed exceptions including affected targets; baseline regressions/resolutions; structural failures cannot be waived. | `policy.test.mjs`: report success is not release eligibility; changed target, revision or expiry invalidates exception; empty/dirty evidence blocks release. Screenshot quality still needs a browser run. |
| AA-099 Destination verification | fixed and tested | `destinations.mjs` is used before actual runner screenshots; checks screen identity plus ready heading/content and actual theme. | Fake page exercises the real verifier and wrong-destination rejection. Rendered execution is blocked by missing Chromium; no screenshot pass claimed. |
| AA-100 Deterministic states | fixed and tested for transport/fixture contracts; rendered coverage blocked | `fixture-states.mjs` is invoked by the runner. Seven states cover Plugins, Build, Settings, Chat, and Agents. All API/RPC calls are fulfilled/refused, other origins/WebSockets/service workers blocked, and each state gets fresh synthetic storage. | Fixture tests verify production/cross-origin refusal, API/RPC interception, unknown operation denial and actual route installer. Browser run still required. Voice, Research, Media and additional lifecycle state coverage remain unverified. |
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

The parent-owned normal test runner discovers these `.test.mjs`/`.test.ts` files. The command above is the actual targeted evidence, not a claim that combined tests/typecheck/build passed.

Playwright's expected `/home/agent/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome` is absent. No browser screenshot pass, authenticated account, live provider, deployment, rollback or physical-device test occurred. Run the sweep and synthetic catalog in a browser-equipped isolated preview after integration, review artifacts and attach the exact committed SHA. Populate release records only after separately authorized verification.

## Integration

AA-097 discovery belongs to the parent lane. Fixture expectations depend on current Build section/panel names, owner-scoped workspace keys, resource-policy response and connector status shape; combine them with those fixes. Validators check evidence consistency; they do not fetch or authenticate referenced external artifacts. No competing test framework or service was added.

## Integration regression cleanup

The parent’s combined discovery run exposed three existing test integration mismatches. Updated migration inventory now includes 0017–0021; the Supabase callback’s static redirect helper uses an explicit `.ts` import for native Node (public callback API unchanged); the failure-host test follows the shared Notion routing seam and exercises timeout copy with fresh write approval. The legacy Notion retry expectation no longer preserves `confirmed:true`. The introduced MCP test `prefer-const` issue was fixed without changing its assertion behavior.

Executed normal Node test command with a private scratch `TMPDIR`: `scripts/migration-plan.test.mjs`, `src/lib/supabase/callback-redirect.test.ts`, `src/components/mind/surface-failure-host.test.ts`, and `src/lib/mind/notion-failure-action.test.ts` — **PASS 28/28**, zero failures/skips/cancellations. This is targeted integration evidence, not a live OAuth exchange.
