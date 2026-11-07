# GitHub — pass 2026-11-07f
Product: **Adrian's Mind** / Adrian's Mind Command OS. Repo: `emzylavish-art/adrians-mind-command-os`.
Captured: 2026-11-07 01:38:13 WAT (Africa/Lagos)
Method: cursor-github MCP (list_branches, list_commits, compare_commits, get_file_contents) + `gh` deployments/compare.

## Branch tips

| Ref | SHA | vs 07e |
|---|---|---|
| origin/main | `e4ed639` (e4ed639814e63ba686c273ba4e9018b2740dde76) — "Add GPT MCP proxy server…" 2026-11-05T22:58:49Z | **UNCHANGED** |
| origin/preview/integration | `aa53aa0` (aa53aa0ad54486d9af6649a1307c524c6c34527f) — "Phase 5: harness MODEL_PROVIDER…" 2026-11-03T06:18:24Z | **UNCHANGED** |
| Production deployment tip | `e3ccc51` (e3ccc51f568ffb4942f155515041d8da469e298c) — env=Production created 2026-11-06T04:38:15Z (id 7592505183) | **UNCHANGED** |
| whisper-flow | `5ab07d0` (5ab07d0fdbe33aff315bed6ee4123f368d8bf53b) | **UNCHANGED** |
| voice-cloning-studio | `55d12ec` (55d12ec97134a133185bef6be7da114613642afe) | **UNCHANGED** |
| origin/rea-features | `a5f969a` (a5f969aa4565770589ffed3a5b8a7662962849d3) — "docs(rea): internal audit pass 2026-11-07e" | remote tip; worktree matches |
| worktree rea-features HEAD (local) | `a5f969a` (was `d9b0253` in 07e) | **local/docs tip moved**; **not a live/prod baseline** |

## Compare main...preview/integration
- status: **diverged**
- ahead_by: **85** / behind_by: **311** / total_commits: 85
- base_sha: `e4ed639`; merge_base: `714ad22`
- vs 07e: **UNCHANGED**
- Artifact: `compare-main-preview.json`

## Production tip
- Latest Production deployment SHA: `e3ccc51` — **UNCHANGED** vs 07e
- Artifact: `deployments-prod.json` (top 5 Production + recent Preview list)

## Recent commits (main, newest first)
- e4ed639 Add GPT MCP proxy server…
- a2fe5b3 Add clear run instructions for web app and team runner
- 7b87fff Add docs index listing all specifications and blueprints
- d562f70 Add Arcanum AI Security Resource Hub learning path
- d6877f2 Add Attack-Side Cybersecurity Blueprint…

## Recent commits (preview/integration, newest first)
- aa53aa0 Phase 5: harness MODEL_PROVIDER xai/openai…
- c1ee830 fix(ui): phone drawer nav + honest Notion status
- b84dcc2 fix(auth): first-party Google/GitHub OAuth…
- 23860f7 fix(auth): mutable OAuth callback redirect…
- 518db93 fix(login): keep Google/GitHub enabled on auth loader fallback

## tools/registry.json @ main
Copied to `registry-main.json`. Key entries:
- **God's Eyes**: status `identity-unconfirmed`; install not-installed; live not-connected; category unresolved. In-repo GodEye CLI exists on worktree (`rea-features`); upstream identity still unconfirmed. **UNCHANGED** on main.
- **BlackEye**: status `restricted`; install/live blocked; guardrail no phishing/credential-collection. **EXCLUDED** this pass. **UNCHANGED**
- REA: implemented / callable-cli-and-ci
- Mind Command OS Security Review: implemented (path-mode only; no URL mode)
- OWASP ZAP @ main: source-verified; live not-connected (in-repo passive probe used from worktree)
- L1B3RT4S: source-verified; **not run** (excluded per pass rules)

### Worktree registry drift (local only; not Production)
- Local `rea-features` registry marks **God's Eyes** as `implemented` / `repo-code-present` / `callable-cli-and-ci` and **OWASP ZAP** as `implemented` — main still `identity-unconfirmed` / `source-verified`. Not merged to main/Production. Flagged as worktree-only; not a live delta.

## Live asset (cross-check with probes)
- Bundle `index-qV1VC2j2.js` — **UNCHANGED** vs 07e
- Also present: react-DB-4Zxce.js, actions-BG0IWsrI.js, link-Lxx_zRdo.js, route-BAhszpLd.js, routes-wC3KRy8L.js, client-CJ-to4pt.js, workspace-BJAXxp_0.js, memory-saved-indicator-DIEJAYLn.js
- Third-party: `https://grok.com/grok-app-builder/extensions.js` still loaded

## CHANGED vs 07e
- **None** for tracked live/prod SHAs, compare stats (85/311), Production tip, pillar branch tips, registry GodEye/BlackEye on main, or live bundle.
- Local note only: worktree `rea-features` HEAD `d9b0253` → `a5f969a` (docs commit for 07e; not Production/live).
