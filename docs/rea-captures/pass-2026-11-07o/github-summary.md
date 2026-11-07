# REA pass 2026-11-07o — GitHub summary (method B)

Product: **Adrian's Mind** / Adrian's Mind Command OS (never Edurain).  
Repo: `emzylavish-art/adrians-mind-command-os`  
Sources: `cursor-github` MCP + `gh` (branches/commits/compare/Production deployments) + live HTML curl.  
Vercel MCP `user-Vercel` returned 0 teams / 0 projects for this bot session → Production tip from GitHub Deployments API.  
Read-only. Captured ~2026-11-07 03:34 WAT (Africa/Lagos).

## Tip / asset rollup vs prior (e4ed639 / aa53aa0 / e3ccc51) and pass 07n

| Ref | Prior / 07n | 07o | Verdict |
|-----|-------------|-----|---------|
| `origin/main` | `e4ed639` | `e4ed639814e63ba686c273ba4e9018b2740dde76` | **UNCHANGED** |
| `origin/preview/integration` | `aa53aa0` | `aa53aa0ad54486d9af6649a1307c524c6c34527f` | **UNCHANGED** |
| Production deploy tip | `e3ccc51` | `e3ccc51f568ffb4942f155515041d8da469e298c` (id 7592505183, created 2026-11-06T04:38:15Z → 2026-11-06 05:38:15 WAT) | **UNCHANGED** |
| Live asset | `index-qV1VC2j2.js` | `index-qV1VC2j2.js` | **UNCHANGED** |
| compare `main`…`preview/integration` | 85 ahead / 311 behind | status=`diverged`, **ahead_by=85**, **behind_by=311**, total_commits=85, merge_base `714ad22` | **UNCHANGED** |
| compare `main`…`e3ccc51` | ahead 24 / behind 0 | status=`ahead`, **ahead_by=24**, **behind_by=0** | **UNCHANGED** |
| `whisper-flow` | `5ab07d0` | `5ab07d0fdbe33aff315bed6ee4123f368d8bf53b` | **UNCHANGED** |
| `voice-cloning-studio` | `55d12ec` | `55d12ec97134a133185bef6be7da114613642afe` | **UNCHANGED** |
| `rea-features` (origin + local wt) | `0715d6b` (07n) | `aed35895595b579deeba8ce872dcefe3fb11346d` | **CHANGED** — docs(rea): internal audit pass 2026-11-07n @ 2026-11-07T02:25:39Z (03:25:39 WAT) |

**ONLY delta vs prior tips:** `rea-features` advanced by the prior pass's docs commit. No prod / live / main / preview / pillar tip movement.

## Recent commits (limit 5)

### main
1. `e4ed639` — Add GPT MCP proxy server so Claude, Grok, and ChatGPT can call your OpenAI API (2026-11-05T22:58:49Z → 2026-11-05 23:58:49 WAT)
2. `a2fe5b3` — Add clear run instructions for web app and team runner
3. `7b87fff` — Add docs index listing all specifications and blueprints
4. `d562f70` — Add Arcanum AI Security Resource Hub learning path
5. `d6877f2` — Add Attack-Side Cybersecurity Blueprint starting from Linux foundations

### preview/integration
1. `aa53aa0` — Phase 5: harness MODEL_PROVIDER xai/openai with one-token readiness probe (2026-11-03T06:18:24Z → 2026-11-03 07:18:24 WAT)
2. `c1ee830` — fix(ui): phone drawer nav + honest Notion status
3. `b84dcc2` — fix(auth): first-party Google/GitHub OAuth without supabase.co in the browser
4. `23860f7` — fix(auth): mutable OAuth callback redirect so Set-Cookie can merge
5. `518db93` — fix(login): keep Google/GitHub enabled on auth loader fallback

## Branches
- Count: **106** (page1=100 + page2=6) — same as 07n/07m.
- No NEW branch that moves a pillar or prod tip.
- Sample present: `main`, `preview/integration`, `whisper-flow`, `voice-cloning-studio`, `rea-features`, `dashboard-3d*`, `fix/*`, `fleet/*`, `preview/*`, `visual-*`, `mcp-integration*`.

## Production deployments (latest 3)
| id | sha | created_at (UTC → WAT) |
|----|-----|------------------------|
| 7592505183 | e3ccc51… | 2026-11-06T04:38:15Z → 2026-11-06 05:38:15 WAT |
| 7586826135 | 532ed14… | 2026-11-05T22:18:59Z → 2026-11-05 23:18:59 WAT |
| 7586772946 | 6e66e6f… | 2026-11-05T22:16:26Z → 2026-11-05 23:16:26 WAT |

## Live bundle
`curl` HTML → `/assets/index-qV1VC2j2.js` (+ known `https://grok.com/grok-app-builder/extensions.js`).

## tools/registry.json
- Present on **main** and **rea-features** (not on preview/integration tree).
- Entries of note (main): `God's Eyes` status=`identity-unconfirmed`; `BlackEye` status=`restricted` (excluded from runs).
