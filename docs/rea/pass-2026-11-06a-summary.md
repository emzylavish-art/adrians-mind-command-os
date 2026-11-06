# REA internal audit — pass 2026-11-06a

**When:** 2026-11-06 ~15:48 America/Chicago (CST)  
**Product:** Adrian's Mind Command OS (never Edurain)  
**Repo:** emzylavish-art/adrians-mind-command-os  
**Worktree:** /workspace/rea-features-wt @ `9709527` (rea-features)  
**Live:** https://adrians-mind.vercel.app  
**Prior baseline:** pass 2026-11-03v (main `014b36d`, preview `aa53aa0`)

## Tips

| Ref | SHA |
|---|---|
| origin/main | `e4ed639814e63ba686c273ba4e9018b2740dde76` |
| origin/preview/integration | `aa53aa0ad54486d9af6649a1307c524c6c34527f` |
| GitHub Deployments env=Production (latest) | `e3ccc51` (zapia/pc-approvals-error-repair-2026-11-05) |
| Worktree HEAD | `9709527` |

- `origin/main...origin/preview/integration` left-right: **311 / 56** (main far ahead; preview still frozen)
- `origin/main...e3ccc51` left-right: **0 / 24** → Production includes **all of main** plus **24** PC-approvals commits not on `origin/main`
- Commits on main since `014b36d`: **59** (see `commits-main-delta.txt`)

## main-delta (014b36d → e4ed639)

**Headline tip commit:** `e4ed639` — Add GPT MCP proxy server (`mcp/gpt_proxy_server.py` + README; local stdio OpenAI proxy for Claude/Grok/ChatGPT — **not** a live Vercel route).

**Auth / login / security (landed on main, present in Production ancestry):**
- Baseline response headers via `vercel.json`: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` (`28ab163`)
- Sign-up: `/signup` → `/login?mode=sign-up` (`28ab163`); live shows Create account
- Dashboard owner gate + serializable access denial + protected `/api/mind/dashboard/status` (`ae9eaaa`/`f7bd304`/`a7b4680`/`532ed14` …)
- Auth TLS/Postgres CA path, mutable OAuth callback redirects, isolated preview auth origin, avoid exposing broker env names on login
- **Not** on main/prod: preview-only `serverFnRedirectHref` login success navigation; first-party Google/GitHub OAuth without supabase.co (`b84dcc2` etc. remain on `preview/integration`)

**Voice / UI:** live-voice-bar clearance, mic permission invalidate-on-stop, mobile drawer a11y/keyboard, command palette search row, voice-mode viewport control, dashboard 3D mobile/bloom/filters (spinbot merges)

**Mind features:** local decision router + inert skill library drafts; Safe Keys inventory; workspace sidebar/settings nav restructure; recent-chats by activity

**Docs:** Decision Model Router / self-improving skills spec; Arcanum / attack-side cybersecurity learning paths; RUN.md; docs index

**Diffstat:** 106 files, +5145 / −4501 (tail in `diffstat-main.txt`)

**Branches moved since Nov 3 (sample):** many new `zapia/*`, `fleet/*`, `spinbot/*`, `codex/mcp-oauth-mvp`, `fix/mcp-runner-tool-parity-20261106`, `website-build-team`, etc. (see `branches-since-nov3.txt`). `preview/integration` still `aa53aa0` (2026-11-03).

## tools

| Tool | Result | Artifact |
|---|---|---|
| GodEye `tools/godeye/godeye.py` | exit 0; engine=requests; title Adrian's Mind; 2 links (/explore,/login); 69 buttons (sidebar still buttons); scripts include `grok.com/.../extensions.js`; **screenshot=null** (no Playwright this run); note: upstream identity still unconfirmed | `godeye.json` |
| OWASP ZAP passive | exit 0; findings: **missing CSP**, **missing Permissions-Policy** (XCTO/XFO/Referrer-Policy now present) | `zap-passive.json` |
| REA offline | exit 0; 1287 files inventoried | `rea-repo.json` |
| security_review offline | exit 0; 90 heuristic findings (mostly dynamic_eval in tests/fixtures; not live probes) | `security-review.json` |
| BlackEye / L1B3RT4S / identity-unconfirmed | **not run** | — |

## live-probes

| Path | Status | Notes |
|---|---|---|
| `/` | 200 | Headers: XCTO nosniff, XFO DENY, Referrer-Policy strict-origin-when-cross-origin, HSTS; **no CSP / Permissions-Policy** |
| `/login` | 200 | Sign in / Sign up; Google+GitHub; Apple “Not enabled yet”; X unavailable |
| `/signup` | 307 → `/login?mode=sign-up` | New vs Nov 3 baseline |
| `/login?mode=sign-up` | 200 | “Create account” |
| `/dashboard` | 307 → `/login?next=%2Fdashboard` | Signed-out gate |
| `/memory` `/explore` | 200 | |
| `/personas` | 307 → `/explore` | |
| `/api/health` | 404 | No health route |
| `/api/mind/dashboard/status` | 401 | `Sign in is required.` |
| `/api/mind/oauth/{github,gmail,google_calendar,google_drive,notion,slack}/status` | **401** | Same six-endpoint spam pattern |
| `/api/mind/oauth/google/status` | 404 | Non-connector alias |
| `/api/mind/turn` `/api/mind/agent` `/api/mind/mcp/tools` `/api/mind/pc/approvals` | 401 | Auth required |
| Sidebar deep routes `/library` `/projects` `/scheduled` `/settings` `/artifacts` `/canvas` `/voice` `/chat` … | 404 | Still no dedicated routes |
| Current home bundle assets (`/assets/*`, brand, icons) | **200** | Current hashes OK |
| `https://grok.com/grok-app-builder/extensions.js` | 200 | Still loaded from home |

Scripted `Sec-Fetch-Site: cross-site` + cors on unsigned APIs → **401** (auth first), not 403. Authenticated cross-site 403 not re-verified this pass.

## pillars

| Pillar | State | Evidence |
|---|---|---|
| Whisper Flow | **partial live / full branch-only** | Live: voice mode / dictate / Start voice buttons (GodEye). Full module on `origin/whisper-flow` (`src/lib/mind/whisper-flow/*`, `whisper-flow-bar.tsx`). Not a first-class `/whisper` route (404). |
| Voice Cloning Studio | **branch-only / missing live** | `origin/voice-cloning-studio` has `src/components/mind/voice-cloning-studio/*` + `src/lib/mind/voice-cloning/*`. Absent from main/prod tree listing; no `/voice-studio` route. |
| Tool Registry (GodEye only; BlackEye excluded) | **partial** | `tools/registry.json`: God's Eyes=`implemented` (upstream identity unconfirmed); BlackEye=`restricted` untouched. Live site has no `/tools`/`/registry` pages (404). In-app tool honesty strings in bundle. |
| Continuous evolution | **partial** | Main added `decision-router.ts`, `skill-library.ts`, docs spec `docs/decision-model-and-self-improving-skills-spec.md` — drafts/inert; not proven as live autonomous evolution loop. |

## changed-known-items

| Item | Status vs prior |
|---|---|
| Missing browser security headers | **Partially fixed+live** — XCTO/XFO/Referrer-Policy now on live (main `vercel.json`). **Still missing:** CSP, Permissions-Policy (ZAP). |
| Sign-up / baseline headers | **New on live** (was absent Nov 3) |
| Dashboard owner/status protection | **Improved on live** — unsigned status 401; owner gate commits in Production ancestry |
| XAI_API_KEY unset in production | **Unchanged (open)** — this Vercel MCP team has no `adrians-mind` project; unsigned APIs only return auth errors; bundle still has Grok “Not configured” honesty path |
| 403 /login fixes on preview only | **Unchanged** — `serverFnRedirectHref` + first-party OAuth still **preview/integration only**; not in `e3ccc51`/`main` |
| forbidden_cross_site isolation | **Unchanged in code** (`isolation.server.ts` still throws 403); unsigned scripted → 401; auth’d case not re-proven |
| OAuth 401 spam (6 connectors) | **Unchanged** |
| Sidebar buttons-not-anchors | **Unchanged** (GodEye) |
| grok extensions.js third-party | **Unchanged** |
| 11 sidebar deep-link 404s | **Unchanged** as HTTP routes |
| heavy-asset 404s | **Likely improved for current tip** — sampled current `/assets/*` all 200; prior hash-specific 404s obsolete |
| live-search env unset | **Unchanged** (bundle “Web search / Not configured”) |
| Voice Cloning Studio missing | **Unchanged** (branch-only) |
| GodEye upstream identity unconfirmed | **Unchanged** |
| Cloudflare burner pending | **Unchanged** (not probed as live target) |
| chat layout / ⌘K / Artifacts/Canvas / empty panels | **⌘K hint present** in home HTML; Artifacts/Canvas routes still 404; authenticated empty-panel walk **not run** |

## P0 vs main/prod promotion

| P0 | Fixed+live by this promotion? |
|---|---|
| XAI_API_KEY production | **No** (unverified / still open) |
| forbidden_cross_site 403 on sidebar views | **No clear fix** (guard still present) |
| /login redirect after Supabase success | **No** (fix remains on preview only) |
| Baseline missing XCTO/XFO/Referrer (was bundled with headers finding) | **Yes, partial** — those three now live; CSP/Permissions-Policy remain |

## candidate-NEW-findings (only truly new)

1. **Production tip ahead of `origin/main`:** GitHub `Production` deployment tip `e3ccc51` = main `e4ed639` + **24** unmerged `zapia/pc-approvals-error-repair` commits. Live is not “main tip only”; main is behind what Production serves.
2. **Residual header gap after baseline fix:** CSP and Permissions-Policy still absent on live HTML (ZAP medium) — track as residual of the Nov 2/3 headers item, not a duplicate “all headers missing.”
3. **Large main promotion since Nov 3 with preview freeze:** 59 commits on main (MCP proxy, owner gates, sign-up, skills/router drafts, voice/mobile fixes) while `preview/integration` remains `aa53aa0` — preview-only login/OAuth fixes still not promoted.

## Visual walk (computerUse)
- Audit credentials from rea-audit-login.env **rejected** on /login (no captcha).
- Browser /dashboard showed Access denied before successful sign-in; curl unsigned still 307→/login.
- /memory and /explore rendered signed-out; explore notes persona handoff not verified.
- Authenticated sidebar walk not completed.

No other net-new live defects beyond known list + the routed NEW items above.

## Artifacts

Directory: `/workspace/rea-captures/pass-2026-11-06a/`

- `summary.md` (this file)
- `commits-main-delta.txt`, `diffstat-main.txt`, `branches-since-nov3.txt`, `tips.txt`, `production-tip.txt`
- `godeye.json`, `zap-passive.json`, `rea-repo.json`, `security-review.json`
- Header/body captures, `home.html`, `login.html`, sampled assets under `assets/`
