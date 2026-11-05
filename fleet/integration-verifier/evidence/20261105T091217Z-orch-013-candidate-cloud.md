# Integration Verifier evidence — orch-013 candidate @ 89486b848145d00d9b4afbf28b0d5effc4150526

- UTC: 20261105T091217Z
- Order: orch-013
- Target: emzylavish-art/adrians-mind-command-os, branch fleet/integration/candidate after PR #17, SHA `89486b848145d00d9b4afbf28b0d5effc4150526`
- Checkout: detached HEAD. `git rev-parse HEAD` was `89486b848145d00d9b4afbf28b0d5effc4150526` before `npm ci` and still that SHA after `npx playwright test`, before this evidence was written.
- Host: node v22.23.4, npm 10.9.9
- Overall result: **pass**
- Reporter: cloud agent. This run did not call OpenAI, xAI, or any other provider. No provider API key was set in the environment.

All four suite commands exited 0. Overall is pass only because `npm ci`, `npm run typecheck`, `npm test`, and `npx playwright test` each succeeded on this single run.

## Commands

| command | exit | result |
|---------|------|--------|
| `npm ci` | 0 | pass |
| `npm run typecheck` (`tsc --noEmit`) | 0 | pass |
| `npm test` | 0 | pass — scripts lane 202 pass / 0 fail / 4 skip; TypeScript lane 1063 pass / 0 fail |
| `npx playwright test` | 0 | pass — 1 passed |

### npm ci (exit 0)

Added 525 packages, audited 526 packages in 32s. npm printed deprecation warnings for `recharts@2.15.4` and `eslint@9.39.5`, plus an audit notice of 12 vulnerabilities (2 low, 8 moderate, 1 high, 1 critical). Exit code was 0. No `npm install` and no lockfile edit. Working tree stayed clean after install (`node_modules` is gitignored).

### typecheck (exit 0)

`tsc --noEmit` completed with no diagnostics. Recorded exit 0.

### npm test (exit 0)

One run of `npm test`. `package.json` `pretest` is `playwright install chromium`, so that install ran as part of this command and completed before the test script. The test script is `node --test 'scripts/**/*.test.mjs' && node --experimental-strip-types --test <src and components *.test.ts …>`. Both lanes ran. The command was not re-run.

`pretest` downloaded:

- Chrome for Testing 156.0.8078.4 (playwright chromium v1248) to `/home/ubuntu/.cache/ms-playwright/chromium-1248`
- FFmpeg (playwright ffmpeg v1013) to `/home/ubuntu/.cache/ms-playwright/ffmpeg-1013`
- Chrome Headless Shell 156.0.8078.4 (playwright chromium-headless-shell v1248) to `/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1248`

Scripts lane (`scripts/**/*.test.mjs`):

- tests 206
- suites 0
- pass 202
- fail 0
- cancelled 0
- skipped 4
- todo 0
- duration_ms 4257.424718

The four skips are `ok` tests marked `# SKIP skipping: gitignored .grok/skills/og is absent in this worktree`:

1. `SKILL.md and AGENTS.md name the marker path and bound this script uses`
2. `the sections that own the brand-task prohibition never affirm a wait`
3. `SKILL.md tells the pass to self-check with the flag this CLI accepts`
4. `every hand-over the og skill prints is one this script accepts`

Skips are not failures. The TAP log contains no `not ok` lines.

TypeScript lane (`node --experimental-strip-types --test …`):

- tests 1063
- suites 287
- pass 1063
- fail 0
- cancelled 0
- skipped 0
- todo 0
- duration_ms 11720.290821

Combined recorded counts: 1265 passed, 0 failed, 4 skipped. `npm test` exit code was 0.

No provider key was used. The only environment name matching a secret-like scan was `GIT_CONFIG_KEY_0` (git internal config transport). Its value was not printed. xAI adapter tests in this run use shape-valid fake keys in the test file; they are not live provider calls.

### Playwright (exit 0)

`playwright.config.mjs` and `e2e/config-loads.spec.mjs` are present on the candidate tip. Browsers were already installed by `npm test`'s pretest, so Chromium was not installed again.

`npx playwright test` once:

```
Running 1 test using 1 worker

(node:4937) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓  1 [chromium] › e2e/config-loads.spec.mjs:3:1 › playwright config loads (5ms)

  1 passed (366ms)
```

The runner exit code was 0. `test-results/` was left untracked and was not committed.

## Constraints observed

- Did not touch main, deploy, or prod.
- No force-push. Evidence commit is only on `fleet/integration-verifier/evidence`.
- No secrets read or logged.
- No simulated success. Each suite command was run once and the recorded exit is the process exit.
- No `npm install` repair of the lockfile.
- No live OpenAI, xAI, or other provider call from this run.
- No PR opened.

## Artifacts

- `20261105T091217Z-orch-013-npm-test.summary.txt` — pretest completion lines, four skip records, and both TAP summaries (full `*.log` is gitignored and was not committed)
- `20261105T091217Z-orch-013-playwright.txt` — `npx playwright test` list-reporter output
