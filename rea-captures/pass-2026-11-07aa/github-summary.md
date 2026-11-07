# GitHub summary — pass 2026-11-07aa

Product: **Adrian's Mind** / Adrian's Mind Command OS. External lane: paused. Read-only.

Captured: 2026-11-07 ~06:11 WAT (Africa/Lagos)  
Repo: `emzylavish-art/adrians-mind-command-os`  
Source: cursor-github MCP (`list_branches` p1, `list_commits`×2, `compare_commits`) + `git fetch` + `gh api` Production deployments. Live asset via curl HTML.

## Tip SHAs vs prior baseline (pass 07z)

| Ref | Prior (07z) | This pass | Delta |
|-----|-------------|-----------|-------|
| `main` | `e4ed639` | `e4ed639814e63ba686c273ba4e9018b2740dde76` | **UNCHANGED** |
| `preview/integration` | `aa53aa0` | `aa53aa0ad54486d9af6649a1307c524c6c34527f` | **UNCHANGED** |
| Production deploy tip | `e3ccc51` | `e3ccc51f568ffb4942f155515041d8da469e298c` | **UNCHANGED** |
| Live asset | `index-qV1VC2j2.js` | `index-qV1VC2j2.js` | **UNCHANGED** |
| `whisper-flow` | `5ab07d0` | `5ab07d0fdbe33aff315bed6ee4123f368d8bf53b` | **UNCHANGED** |
| `voice-cloning-studio` | `55d12ec` | `55d12ec97134a133185bef6be7da114613642afe` | **UNCHANGED** |
| `rea-features` (remote + local wt) | `5e2e0ac` | `e07fe0408becb117e761bdf5e6c733ed70f1c4f3` | **CHANGED** |

`rea-features` tip move: `e07fe04` — `docs(rea): internal audit pass 2026-11-07z` (2026-11-06 23:09:33 -0600). Docs-only REA capture commit; not a product/main/preview/prod tip change.

## Recent commits

### main (tip `e4ed639`)
1. `e4ed639` — Add GPT MCP proxy server so Claude, Grok, and ChatGPT can call your OpenAI API (2026-11-05 23:58 WAT)
2. `a2fe5b3` — Add clear run instructions for web app and team runner
3. `7b87fff` — Add docs index listing all specifications and blueprints
4. `d562f70` — Add Arcanum AI Security Resource Hub learning path
5. `d6877f2` — Add Attack-Side Cybersecurity Blueprint starting from Linux foundations

### preview/integration (tip `aa53aa0`)
1. `aa53aa0` — Phase 5: harness MODEL_PROVIDER xai/openai with one-token readiness probe
2. `c1ee830` — fix(ui): phone drawer nav + honest Notion status
3. `b84dcc2` — fix(auth): first-party Google/GitHub OAuth without supabase.co in the browser
4. `23860f7` — fix(auth): mutable OAuth callback redirect so Set-Cookie can merge
5. `518db93` — fix(login): keep Google/GitHub enabled on auth loader fallback

## compare main...preview/integration

- status: **diverged**
- ahead_by: **85** / behind_by: **311** / total_commits (ahead): 85
- merge_base: `714ad2240765…`
- files_changed (API page): 300
- html: https://github.com/emzylavish-art/adrians-mind-command-os/compare/main...preview/integration

**UNCHANGED** vs pass 07z (still 85 ahead / 311 behind).

## Branches

- `list_branches` page 1 (per_page=100): includes `main`, `preview/integration`, `rea-features`, `whisper-flow`, `voice-cloning-studio`, many `visual/polish-*`, `fleet/*`, `chatgpt/*`, etc. Link header: page 2 exists.
- Page 2 sample names (gh api): `zapia/mind-correctness-fixes-2026-11-04`, `zapia/mobile-nav-drawer-2026-11-05`, `zapia/pc-approvals-error-repair-2026-11-05`, `zapia/public-landing-private-workspace-20261106`, `zapia/settings-workspace-navigation-20261106`, `zapia-isolated-auth-20261104` — present; no new tip movement on watched product refs.
- Watched product branch tips match 07z except `rea-features` (docs-only).

## Production

- Latest GitHub Deployment environment=Production: id `7592505183`, sha/ref `e3ccc51f568ffb4942f155515041d8da469e298c`, created `2026-11-06T04:38:15Z` (= 2026-11-06 05:38:15 WAT)
- Live HTML still references `/assets/index-qV1VC2j2.js` (matches 07z / live-probe).

## NEW vs known (GitHub lane)

**No product tip SHA changes** on main / preview/integration / Production / whisper-flow / voice-cloning-studio / live asset.  
**Only** `rea-features` moved (`5e2e0ac` → `e07fe04`, REA docs commit for pass 07z). Not a product fix routing item.
