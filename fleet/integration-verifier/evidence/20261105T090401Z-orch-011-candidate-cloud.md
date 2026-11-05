# Integration Verifier evidence — orch-011 candidate @ 143a9d9b107a9c3fb9a96a01e5307211cdbc4613

- UTC: 20261105T090401Z
- Order: orch-011
- Target: emzylavish-art/adrians-mind-command-os, branch fleet/integration/candidate, SHA 143a9d9b107a9c3fb9a96a01e5307211cdbc4613 (tip after PR #16)
- Checkout: detached HEAD. `git rev-parse HEAD` was `143a9d9b107a9c3fb9a96a01e5307211cdbc4613` before the suite and again immediately before each suite command.
- Host: node v22.23.4, npm 10.9.9
- Overall result: **fail**
- Reporter: cloud agent (not Adrian). This VM did not call OpenAI or xAI. Live provider facts below are copied from the host probe file.

`npm test` exited 1, so the batch is **fail**. OpenAI host probe is pass and xAI host probe is blocked (HTTP 402). That pair does not upgrade the verdict: blocked applies only when the suite also all passes, and pass applies only when the suite, OpenAI, and xAI all succeed.

## Commands

| command | exit | result |
|---------|------|--------|
| `npm ci` | 0 | pass |
| `npm run typecheck` (`tsc --noEmit`) | 0 | pass |
| `npm test` | 1 | fail — scripts lane 1 failure; TypeScript lane not started |
| `npx playwright install chromium` | 0 | browser downloaded (prerequisite, not a product pass) |
| `npx playwright test` | 0 | pass — 1 passed |

### npm ci (exit 0)

Added 525 packages, audited 526 packages. npm printed deprecation warnings for `recharts@2.15.4` and `eslint@9.39.5`, plus an audit notice of 12 vulnerabilities (2 low, 8 moderate, 1 high, 1 critical). Exit code was 0. No `npm install` and no lockfile edit.

### typecheck (exit 0)

`tsc --noEmit` completed with no diagnostics.

### npm test (exit 1)

One run of `npm test`. The script is `node --test 'scripts/**/*.test.mjs' && node --experimental-strip-types --test <src and components *.test.ts …>`. The first command exited 1, so the TypeScript lane never started. It was not re-run after Chromium was installed.

Scripts lane (`scripts/**/*.test.mjs`), one run:

- tests 206
- pass 201
- fail 1
- skipped 4
- duration_ms 4604.929471

Failed test:

1. `opens a local html document without a network page` — `scripts/mind-browser.test.mjs:14`. AssertionError `1 !== 0` (expected child status 0, actual 1). The TAP record does not include child stderr.

The four skips are `ok` tests marked `# SKIP skipping: gitignored .grok/skills/og is absent in this worktree` (three brand-check CLI tests and one og hand-over test). Skips are not failures.

Separate one-shot of the same child the test spawns (`MIND_BROWSER_ALLOW_DATA=1 node scripts/mind-browser.mjs 'data:text/html,<title>Pier</title><p>Water is low.</p>'`), run before `npx playwright install chromium`. This is not a second `npm test` and does not change the recorded exit 1:

```
MIND_BROWSER_ALLOW_EXIT=1
browserType.launch: Executable doesn't exist at /home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
Error at scripts/mind-browser.mjs:16:32
```

`chromium.launch` sits outside the script's try/catch, so a missing browser executable exits 1. No provider key was used. No API-key-like environment variables were set on this VM (`GIT_CONFIG_KEY_0` was the only name that matched a secret-like scan).

### Playwright (exit 0)

`playwright.config.mjs` and `e2e/config-loads.spec.mjs` are present on this tip. `npx playwright install chromium` exited 0 and downloaded Chrome for Testing 156.0.8078.4 (playwright chromium v1248), FFmpeg (playwright ffmpeg v1013), and Chrome Headless Shell 156.0.8078.4 (playwright chromium-headless-shell v1248).

`npx playwright test` once:

```
Running 1 test using 1 worker
  ✓  1 [chromium] › e2e/config-loads.spec.mjs:3:1 › playwright config loads (4ms)
  1 passed (375ms)
```

Node also printed: `The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.` The runner exit code was 0.

## Live providers (host probe, not this VM)

Source file copied verbatim: `20261105T090056Z-orch-011-provider-probes.json` (host UTC 20261105T090056Z, candidate SHA matches). Bot secret forwarding is disabled on this account. This VM did not call OpenAI or xAI and did not invent results.

### OpenAI — **pass**

- models HTTP 200, 96 models
- chat HTTP 200, model `gpt-4o-mini-2024-07-18`, content preview `Pong.`
- result: `pass`
- key source: `OPENAI_API_KEY` env (value not logged)

### xAI — **blocked**

- HTTP 402
- error preview: `You have run out of credits or need a Grok subscription`
- result: `blocked` (not passed)
- key source: `/home/box/.secrets/xai/integration-verifier.key` (value not logged)
- note from the probe file: `Recorded blocked, not passed, per orch-009/011`

## Constraints observed

- Did not touch main, deploy, or prod.
- No force-push. Evidence commit is only on `fleet/integration-verifier/evidence`.
- No secrets read or logged. Probe JSON key values were already redacted by the host.
- No simulated success. `npm test` failed and was not re-run after the browser download.
- Single run of each ordered suite command. No `npm install` repair of the lockfile.
- No live OpenAI or xAI call from this VM.

## Artifacts

- `20261105T090401Z-orch-011-npm-test.excerpt.txt` — failing TAP block, scripts-lane summary, and the separate child stderr (`.txt` because `*.log` is gitignored)
- `20261105T090401Z-orch-011-playwright.txt` — `npx playwright test` list-reporter output
- `20261105T090056Z-orch-011-provider-probes.json` — host probe JSON, copied unchanged
