# Integration Verifier evidence — orch-002 candidate @ 6a5b40f8fc4b2a4cc965f93e8ed827df47faff53

- UTC: 20261105T073842Z
- Order: orch-003 exception (single cloud run of the orch-002 candidate suite)
- Target: emzylavish-art/adrians-mind-command-os, branch fleet/integration/candidate, SHA 6a5b40f8fc4b2a4cc965f93e8ed827df47faff53
- Checkout: detached HEAD at that SHA before any command (`git rev-parse HEAD` matched the full SHA)
- Host: node v22.23.4, npm 10.9.9
- Overall result: **fail**
- Reporter: cloud agent (not Adrian)

Live provider, MCP oauth, `mcp:e2e`, `mcp:stdio-e2e`, `mcp:verify-live`, and API probes were out of scope for this orch-003 exception and were not run.

## Commands

| command | exit | result |
|---------|------|--------|
| `npm ci` | 1 | fail — lockfile out of sync; `node_modules` not created |
| `npm run typecheck` (`tsc --noEmit`) | 127 | fail — `tsc` not found (install did not complete) |
| `npm test` | 1 | fail — scripts lane 3 failures; TypeScript lane not started |
| Playwright | — | **not-found** (not a pass) |

### npm ci (exit 1)

`npm ci` refused the tree:

```
npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync.
npm error Missing: lru-cache@11.5.3 from lock file
```

The lockfile resolves `lru-cache@5.1.1` only. `node_modules/nitro/node_modules/unstorage` declares an optional peer `lru-cache: ^11.2.6` with no locked 11.x entry. npm 10.9.9 then requires `lru-cache@11.5.3` and aborts. No second install was attempted.

### typecheck (exit 127)

```
> typecheck
> tsc --noEmit
sh: 1: tsc: not found
```

`tsc` was not on PATH because `npm ci` did not install devDependencies. This is not a TypeScript diagnostic run.

### npm test (exit 1)

The script is `node --test 'scripts/**/*.test.mjs' && node --experimental-strip-types --test <src *.test.ts …>`. The first command exited 1, so the `src` / `components` TypeScript tests never started.

Scripts lane (`scripts/**/*.test.mjs`), one run:

- tests 206
- pass 199
- fail 3
- skipped 4
- duration_ms 611.326267

Failed tests:

1. `opens a local html document without a network page` — `scripts/mind-browser.test.mjs:14`. AssertionError `1 !== 0` (expected child status 0). The TAP record does not include child stderr. `scripts/mind-browser.mjs` imports `playwright` after its allow-checks, and `node_modules` was absent.
2. `verify-xai missing-key path runs without a live call` — `scripts/verify-xai.test.mjs:5`. Child crashed with `ERR_MODULE_NOT_FOUND: Cannot find package '@electric-sql/pglite'` imported from `scripts/verify-xai.mjs`, then the test saw status `1 !== 0`.
3. `verify-xai with key unset still exits cleanly when live is off` — `scripts/verify-xai.test.mjs:19`. Same missing `@electric-sql/pglite` crash and status `1 !== 0`.

No API keys were present in the environment (only `GIT_CONFIG_KEY_0` matched a secret-like name scan). The verify-xai failures are missing installed modules, not live provider calls.

### Playwright

Searched the candidate worktree for `playwright.config.*`, `*.spec.ts`, `*.spec.js`, and `*.spec.tsx`. None found. `playwright` is a devDependency (`^1.62.0`) and is imported by `scripts/mind-browser.mjs`. That is not a Playwright suite. Status: **not-found**. No Playwright runner was invoked. This is not a pass.

## Constraints observed

- Did not touch main, deploy, or prod.
- No force-push. Evidence commit is only on `fleet/integration-verifier/evidence`.
- No secrets read or logged.
- No simulated success. Install, typecheck, and the TypeScript half of `npm test` did not complete.
- Single run of each ordered command. No `npm install` repair of the lockfile.

## Artifacts

- `20261105T073842Z-orch-002-npm-test.excerpt.txt` — failure blocks and the scripts-lane summary only (`.txt` because `*.log` is gitignored)
