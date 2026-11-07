# GitHub + tools + live probe — REA pass 2026-11-07az
Product: Adrian's Mind (Adrian's Mind Command OS)
Captured: 2026-11-07 ~10:52 WAT (Africa/Lagos) / 03:52 CST (America/Chicago)
Repo: emzylavish-art/adrians-mind-command-os. Read-only; no code edits, no commits/push/merge/force.
Compared to prior pass: 2026-11-07ay.

## Branch tips vs 07ay
| Ref | 07ay | 07az | Status |
|---|---|---|---|
| main | b5d888d | b5d888d | UNCHANGED |
| preview/integration | aa53aa0 | aa53aa0 | UNCHANGED |
| Production READY (Vercel) | main b5d888d / dpl_HmAxBEus6oL75hCkTuXE8NDSM9qF | same | UNCHANGED |
| whisper-flow | 5ab07d0 | 5ab07d0 | UNCHANGED |
| voice-cloning-studio | 55d12ec | 55d12ec | UNCHANGED |
| rea-features (origin) | (ay docs tip) | 23a8760 | NEW tip (docs-only) |

- rea-features NEW tip `23a8760` = `docs(rea): add pass 2026-11-07ay visual+tool artifacts` (docs-only; not an app/runtime change). Prior docs commits on same branch: `96b8aa7` internal audit ay, `04e3761` ax.
- Branch inventory (gh API paginate): **108** — UNCHANGED vs 07ay.
- No branches added/removed vs 07ax/07ay inventory.
- Open PRs (not live): #26 `cursor/visual-polish-041b` @ `c9531fc` (upd 2026-11-07 10:40 WAT / 09:40Z); #25 `cursor/prod-mcp-worker-de4c` @ `e682b1b` (upd 2026-11-07 10:27 WAT / 09:27Z) — both still OPEN, tips UNCHANGED vs 07ay.

### Full SHAs
- main `b5d888dd107c4a06de582a0e29fce551c95b01df`
- preview/integration `aa53aa0ad54486d9af6649a1307c524c6c34527f`
- whisper-flow `5ab07d0fdbe33aff315bed6ee4123f368d8bf53b`
- voice-cloning-studio `55d12ec97134a133185bef6be7da114613642afe`
- rea-features `23a8760f30a2960308ff67f046717d4d99470819`
- PR#25 head `e682b1bd4fa6f7623b6fd99b449a994d582ea299`
- PR#26 head `c9531fc3c82e3871f97186b69207a5e6d670a59e`

### Recent commits (latest 5)
**main**
- b5d888d Merge pull request #23 from emzylavish-art/codex/mcp-oauth-mvp (2026-11-06 23:46:17 -0800)
- a19adbb Merge pull request #24 from emzylavish-art/cursor/worker-mcp-tools-de4c (2026-11-06 23:43:40 -0800)
- fcab42b Fetch harness MCP evidence over public HTTPS. (2026-11-07 06:50:41 +0000)
- 30843aa Verify Cloudflare Access JWTs and add a same-host PKCE harness. (2026-11-07 06:44:21 +0000)
- 267dc39 Publish the test worker bundle outside the ignored dist path. (2026-11-07 06:37:30 +0000)

**preview/integration**
- aa53aa0 Phase 5: harness MODEL_PROVIDER xai/openai with one-token readiness probe (2026-11-03 00:18:24 -0600)
- c1ee830 fix(ui): phone drawer nav + honest Notion status (2026-11-02 20:37:07 -0600)
- b84dcc2 fix(auth): first-party Google/GitHub OAuth without supabase.co in the browser (2026-11-02 19:47:11 -0600)
- 23860f7 fix(auth): mutable OAuth callback redirect so Set-Cookie can merge (2026-11-02 19:24:03 -0600)
- 518db93 fix(login): keep Google/GitHub enabled on auth loader fallback (2026-11-02 19:05:06 -0600)

## compare_commits (gh API)
- main...preview/integration: status **diverged**, ahead **85** / behind **320**, merge-base `714ad22` — **UNCHANGED** vs 07ay
- Note: local `git rev-list` on shallow worktree is unreliable here (merge-base fails locally); use gh API numbers.

## Live asset / deploy
- Homepage HTTP/2 **200** (Vercel). Live JS bundle: **`index-ChogKXym.js`** (`assets/index-ChogKXym.js`) — **UNCHANGED**
- Production READY = main `b5d888d` / `dpl_HmAxBEus6oL75hCkTuXE8NDSM9qF` — **UNCHANGED**
- Headers present: HSTS preload, XCTO nosniff, XFO DENY, Referrer-Policy strict-origin-when-cross-origin
- Headers missing: **CSP**, **Permissions-Policy** (known)

## HTTP status matrix (no auth) — all UNCHANGED vs 07ay
| Path | Status |
|---|---|
| / | 200 |
| /login | 200 |
| /dashboard | 307 → /login?next=%2Fdashboard |
| /memory | 200 |
| /explore | 200 |
| /tools | 404 |
| /voice | 404 |
| /chat | 404 |
| /activity | 404 |
| /voice-cloning-studio | 404 |
| /whisper-flow | 404 |
| /api/tools/registry | 404 |
| /api/mind/oauth/{github,gmail,google_calendar,google_drive,notion,slack}/status | 401×6 |

## Audit secret
- `/home/box/.secrets/rea-audit-login.env`: domain still **example.com** (values not printed; password login not attempted). Known since 06d.

## GodEye (tools/godeye/godeye.py from rea-features-wt)
- Command: `python3 tools/godeye/godeye.py https://adrians-mind.vercel.app --screenshot .../godeye.png --out .../godeye.json`
- exit **0**, engine `requests`, status 200, title "Adrian's Mind", links 2 (/explore,/login both 200), buttons **69**, forms 2, inputs 4, scripts 2, styles 3, console_error_count **0**, broken_same_origin_count **0** — **UNCHANGED** vs 07ay
- Screenshot: null / no godeye.png written (requests engine; Playwright absent)
- note: "in-repo implementation; upstream identity still unconfirmed"
- BlackEye EXCLUDED; L1B3RT4S not run

## ZAP passive (tools/owasp_zap/zap_passive.py)
- exit **0**, engine in-repo-passive-probe (ZAP daemon not installed; active scan disabled), findings_count=**2** — UNCHANGED:
  - missing_content_security_policy (medium)
  - missing_permissions_policy (medium)
- Present: XCTO / XFO / Referrer-Policy / HSTS

## Offline help
- `python3 tools/rea/rea.py --help` exit **0** → rea-help.txt
- `python3 tools/security_review/security_review.py --help` exit **0** → security-review-help.txt

## Blueprint pillars (evidence this pass)
| Pillar | State | Evidence |
|---|---|---|
| Whisper Flow | branch-only | tip `5ab07d0` UNCHANGED; not on main/prod; live `/whisper-flow` **404** |
| Voice Cloning Studio | branch-only | tip `55d12ec` UNCHANGED; not on main/prod; live `/voice-cloning-studio` **404** |
| Tool Registry (GodEye only; BlackEye excluded) | partial | GodEye CLI OK on rea-features (exit 0); upstream unconfirmed; live `/tools` + `/api/tools/registry` **404** |
| Continuous evolution | partial | live still tracks main `b5d888d` / `index-ChogKXym.js` / dpl_HmAxBEus…; pillar features still branch-only/partial; rea-features docs-only tip advance |

## NEW owner-actionable findings vs 07ay
- **None.** Only delta: origin/rea-features docs tip `23a8760` (ay artifact docs). Tracked tips, compare, live asset, probes, ZAP, GodEye summary — all unchanged.

## Artifacts written
- `/workspace/rea-captures/pass-2026-11-07az/` — github-tools.md, summary.md, godeye.json, zap-passive.json, live-probes.txt, oauth-status.txt, live-asset.txt, headers.txt, branches.txt (108), rea-help.txt, security-review-help.txt
- No godeye.png (requests engine)
