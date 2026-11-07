# REA pass 2026-11-07bc — GitHub + tools + blueprint diff (Adrian's Mind Command OS)
Captured ~11:38–11:41 WAT, Nov 7 2026. Read-only. gh CLI (logged in as emzylavish-art) used for GitHub; Vercel MCP (user-Vercel--adrian) for deployments. Vercel CLI on box not logged in (prompted device login, not completed).

## 1. SHA deltas vs 07bb
| Item | 07bb | 07bc | Changed |
|---|---|---|---|
| origin/main | 9f9ea56 | **cbeebe6** (Merge PR #26 visual-polish, 10:31 UTC = 11:31 WAT) | YES (+2: c9531fc, cbeebe6) |
| Prod READY | b5d888d | b5d888d (created 09:33 WAT) | no |
| Live asset | index-ChogKXym.js | index-ChogKXym.js | no |
| preview/integration | aa53aa0 | aa53aa0 | no |
| whisper-flow | 5ab07d0 | 5ab07d0 (main...wf diverged +90/-325) | no |
| voice-cloning-studio | 55d12ec | 55d12ec (diverged +86/-325) | no |
| rea-features | — | 3f246a0 | — |
| Branch count | 108 | 108 | no |

main...preview/integration: diverged, preview ahead 85 / behind 325.

New on main since 9f9ea56 (PR #26): package.json (+1/-1), src/components/mind/command-app.tsx (+88/-22), command-search.css (+10), src/lib/mind/palette-keys.ts (+37, new) + test, visual-polish-contract.test.ts (new), src/routes/login.tsx (+3/-3), src/styles.css (+85). Composer layout, empty states, search keyboard focus.

Main recent: cbeebe6 PR#26 merge · 9f9ea56 PR#25 merge · e682b1b provider key lengths + retest ledger · c9531fc composer polish · 43301c0 adrians-mind-mcp Worker config.
Preview recent: aa53aa0 Phase 5 MODEL_PROVIDER probe · c1ee830 drawer nav/Notion status · b84dcc2 first-party OAuth · 23860f7 OAuth callback cookie · 518db93 login loader fallback.

## Vercel deployments (artifacts: vercel-prod-deployments.txt, vercel-recent-deployments.txt)
- Latest production READY: b5d888d (main), still the live prod.
- main 9f9ea56 → BUILDING, **target=null (preview)**, created 11:29 WAT
- main cbeebe6 → QUEUED, **target=null (preview)**, created 11:31 WAT
- rea-features 3f246a0 QUEUED; three earlier rea-features builds CANCELED.
- Watch: main-branch builds are going to target=null, not production. Either the production branch setting changed or promotion is manual. Confirm next pass whether prod advances past b5d888d.

## Open PRs (6; #26 now merged, #25 merged)
#22 MCP runner tool parity (DRAFT) · #12 voice/connection tool pins (DRAFT) · #9 local agent dispatch (DRAFT) · #7 visual polish 11 (DRAFT) · #6 visual pass-10 stacking (OPEN) · #2 intent predictor (OPEN)

## tools/registry.json @ main (artifact registry-main.json)
29 tools. BlackEye: status=restricted, live=blocked, install=blocked (excluded, OK). "God's Eyes": status=identity-unconfirmed, live=not-connected, install=not-installed. **The in-repo GodEye wrapper (tools/godeye/godeye.py, commit 41f709a) is only on rea-features. It is not in main, preview, whisper-flow, or voice-cloning-studio.**

## Live probes (routes.txt, headers.txt, home.html)
/ 200 · /login 200 · /dashboard 307 · /memory 200 · /explore 200 · /tools /voice /chat /activity /voice-cloning-studio /whisper-flow /api/tools/registry → 404 · OAuth status github/gmail/google_calendar/google_drive/notion/slack → 401 ×6.
Headers: HSTS, nosniff, XFO DENY, Referrer-Policy present; CSP and Permissions-Policy absent.

## Tool runs (from /workspace/rea-features-wt)
| Tool | Exit | Result |
|---|---|---|
| godeye.py | 0 | engine=requests, 200, 69 buttons, 2 forms, 4 inputs, 0 broken same-origin links, 0 console errors; **screenshot=null, so godeye.png was NOT produced** (no browser engine) |
| zap_passive.py | 0 | 2 findings (medium): missing CSP, missing Permissions-Policy. Unchanged |
| rea.py --help | 0 | ok |
| security_review.py --help | 0 | ok |
BlackEye, L1B3RT4S, and identity-unconfirmed tools were NOT run.

## Blueprint pillar diff
| Pillar | Status | Evidence |
|---|---|---|
| Whisper Flow | branch-only | whisper-flow 5ab07d0 (diverged +90/-325 vs main); /whisper-flow 404 live; no whisper paths in main tree |
| Voice Cloning Studio | branch-only / missing live | voice-cloning-studio 55d12ec (+86/-325); /voice-cloning-studio 404, /voice 404; no paths on main |
| Tool Registry (GodEye only) | partial | main has tools/registry.json + src/lib/mind/registry.ts + CI workflow; God's Eyes entry is identity-unconfirmed/not-installed; GodEye wrapper exists only on rea-features 3f246a0; /tools and /api/tools/registry 404 live; BlackEye correctly blocked |
| Continuous evolution | partial | main moving (PR #25/#26 merged today) but prod stuck at b5d888d; main builds deploying as preview target; preview/integration stale since Nov 3 and 325 behind |

## NEW owner-actionable items
1. (Grok Build/deploy) Main merges 9f9ea56 and cbeebe6 are building with Vercel target=null (preview), not production. Prod is still b5d888d. Verify the production branch setting or promote cbeebe6 after it is READY.
2. (Grok Build/REA tools) GodEye wrapper is not on main. It lives only on rea-features (41f709a). The main registry lists only "God's Eyes" as identity-unconfirmed, so the GodEye pillar has no merged adapter.
3. (REA tooling) godeye.py ran with the requests engine and produced no screenshot (godeye.png missing). A Playwright/Chromium engine is needed for visual capture.
