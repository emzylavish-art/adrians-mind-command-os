# Verification records and release evidence

This workflow strengthens existing Node, Playwright, and axe checks. It does not deploy, change settings, call paid providers, or grant permission to promote a release.

## Visual reporting and release gates

`npm run visual:audit` defaults to **report** mode. It captures evidence and reports layout/accessibility findings; a zero exit does not imply visual release readiness. Every screenshot first verifies the expected `data-view` screen identity, a heading or screen-specific ready element, and the requested theme. It also waits for a declared main-content busy state to clear. These checks establish the screen shell; they do not claim every asynchronous service completed.

Use an isolated local preview without real provider keys. Set `NODE_TEST_CONTEXT=visual-audit` when starting the preview to avoid its normal local database, and choose a writable private temporary directory when `/tmp` is constrained.

```bash
BASE_URL=http://127.0.0.1:8080 VISUAL_AUDIT_MODE=report npm run visual:audit
BASE_URL=http://127.0.0.1:8080 VISUAL_AUDIT_MODE=release VISUAL_BASELINE=artifacts/previous-visual/report.json npm run visual:audit
```

Release mode fails on an unverified destination, incomplete capture, navigation failure, missing/dirty candidate revision, or findings over [visual-policy.json](visual-policy.json). Initial thresholds are zero critical/serious axe nodes, no overflowing controls, at most one CSS pixel of document overflow, and no interactive targets below the script's 40-pixel diagnostic. The target-size diagnostic is a product threshold, not a claim that every smaller target violates an accessibility standard. Moderate/minor axe findings remain in the artifact for review. These policy choices are explicit and may be tightened through review.

An exception must identify the exact finding fingerprint and candidate SHA, reviewer, reason, and future expiry. Fingerprints include state, fixture, kind, value, and relevant target evidence. A different control or changed revision invalidates the exception. Structural destination/capture failures cannot be waived. An optional baseline reports newly observed and resolved findings; existing blockers do not disappear merely because they were in the baseline.

## Deterministic functional states

```bash
BASE_URL=http://127.0.0.1:8080 VISUAL_FIXTURE_STATES=plugins-connected,plugins-permission-denied,build-runtime-unavailable,build-revision-conflict,settings-save-failed,chat-interrupted,agent-blocked npm run visual:audit
BASE_URL=http://127.0.0.1:8080 BROWSER_EXECUTABLE_PATH=/path/to/chromium npm run visual:audit -- --fixture-only
```

Each named fixture runs in a fresh local-only context, seeds disposable synthetic state, fulfills or refuses **all** API/RPC requests, blocks other origins and WebSockets, and blocks service workers. The Build conflict and Settings failure controls submit only to this synthetic transport. Unknown actions fail closed; a fixture never forwards a real provider call or account write. The report identifies synthetic transport and observed blocked/fulfilled requests. The normal navigation sweep remains separate.

`--fixture-only` skips the normal sweep completely and defaults to the entire fixture catalog. It accepts local preview origins only. `BROWSER_EXECUTABLE_PATH` selects an existing installed browser; the runner does not download one. A missing executable records a startup failure and exits nonzero without manufacturing screenshots.

The initial executable fixtures cover connected/partial-permission Plugins, unavailable/conflicting Build files, failed Settings persistence, interrupted Chat, and blocked Agents. They are a functional-state foundation, not a claim that all loading, streaming, Voice, Research, Media, or physical-device scenarios passed. Add new deterministic fixtures with concrete expected content and route responses; do not label a screenshot passed until its actual browser run produced the artifact. Node tests verify interception and fixture contracts, not rendered appearance.

The additional local transition runner uses that same intercepted transport:

```bash
BASE_URL=http://127.0.0.1:8080 BROWSER_EXECUTABLE_PATH=/path/to/chromium node scripts/visual/transition-fixtures.mjs
```

It verifies a 180-message conversation's reading position after A→B→A navigation using real wheel input, loading/revealing older messages, a synthetic streaming response becoming Markdown while following the tail, current-buffer symbol/dependency navigation, mobile drawer current state/focus trapping/Escape/reduced-motion/desktop resize, saved light/dark themes, page scroll after long Settings→short Projects→Settings navigation, and loading Build/Voice Studio modules. The stream is an in-page `ReadableStream`; its provider label is explicitly synthetic. Separate media fixtures hold a video start response for 5.5 seconds on a synthetic clock: no accepted/rendering label or status poll is allowed before a receipt, rejection cannot leave progress active, and an accepted operation is polled with its exact request ID without starting again. The returned video URL is synthetic and external fetching remains blocked.

The runner waits for a seeded client-only message before interacting, so server-rendered home markup alone cannot be mistaken for a hydrated application. It reports the legacy bottom navigation as hidden when the current shell CSS hides it and tests the visible drawer. Reports retain exact failed-state observations and screenshots; a failed assertion exits nonzero.

Start the preview and browser in the same network namespace. Environments whose execution cells isolate loopback networking must launch them as sibling processes in one cell. Always stop that preview after verification. These local browser checks do not prove authenticated production behavior or a live provider response.

## Environment matrix

The [environment record](environment-evidence.json) tracks source, isolated regressions, Chromium emulation, authenticated preview, authenticated production, physical iOS, physical Windows, and physical Android separately. A fresh record is unverified. It includes the exact next action rather than a checkmark inferred from another environment.

```bash
node scripts/verification/validate.mjs --environments docs/verification/environment-evidence.json --revision FULL_CANDIDATE_SHA
```

Chromium at 390×844 is emulation. It cannot establish actual iPhone/Safari/PWA behavior, audio hardware, an installed Windows application, or paired-PC capabilities. A physical passed record requires device and browser/runtime identifiers, date, revision, and evidence. Native app versions remain independent of the website revision.

## Revision-aware feature and release evidence

The [feature inventory](feature-evidence.json) keeps implementation and verification separate. Old verified results remain historical when the candidate changes. Existing historical claims are retained in [feature-matrix-legacy.md](feature-matrix-legacy.md), not copied into current completion status.

Copy [release-evidence.template.json](release-evidence.template.json) to an artifact record and fill it with **retrieved, observed evidence**. The template intentionally fails validation. A complete record links required test/typecheck/build results to one SHA, immutable build digest, target database/migrations, deployment ID, observed canonical alias, signed-out and signed-in journeys, environment evidence, and a distinct database-compatible rollback release with an executed recovery check.

```bash
node scripts/verification/validate.mjs --release artifacts/verification/release-evidence.json --revision FULL_CANDIDATE_SHA
```

Failed, skipped, canceled, missing, duplicate, or different-revision required checks block this gate. A READY deployment does not replace journey evidence. The validator checks supplied records for consistency; it does **not** fetch CI logs, authenticate screenshots, inspect branch protection, or prove remote facts. Preserve referenced artifacts and independently retrieve them during release review. This implementation does not claim the current deployment pipeline lacks other protections and does not change or trigger a deployment workflow.

## Executed C1 candidate

The C1 implementation revision `b17e90c5728f7f1a9f303f703fcf073cbdd2175e` has [scoped feature evidence](../audits/evidence/c1-feature-evidence.json), [scoped environment evidence](../audits/evidence/c1-environment-evidence.json), and a [complete validation record](../audits/c1-validation.json). The full-product JSON files in this directory remain templates; actual C1 records bind their evidence to the committed source and explicitly leave authenticated/live/physical environments unverified. Evidence packaging may be a later documentation-only commit.
