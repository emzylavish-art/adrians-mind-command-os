# REA pass 2026-11-07n — GitHub blueprint (CHANGES vs 07m)

Product: **Adrian's Mind** / Adrian's Mind Command OS (never Edurain).  
Repo: `emzylavish-art/adrians-mind-command-os`  
Sources: `gh` CLI (branches, commits, compare, Production deployments) + live HTML bundle curl.  
Read-only. Captured ~2026-11-07 03:23 WAT (Africa/Lagos).

## Tip / asset rollup vs pass 2026-11-07m

| Ref | 07m | 07n | Verdict |
|-----|-----|-----|---------|
| `origin/main` | `e4ed639` | `e4ed639814e63ba686c273ba4e9018b2740dde76` | **UNCHANGED** |
| `origin/preview/integration` | `aa53aa0` | `aa53aa0ad54486d9af6649a1307c524c6c34527f` | **UNCHANGED** |
| Production deploy tip (env=Production) | `e3ccc51` | `e3ccc51f568ffb4942f155515041d8da469e298c` (id 7592505183, created 2026-11-06T04:38:15Z → 2026-11-06 05:38:15 WAT) | **UNCHANGED** (newest Production deployment record; status API: `inactive` / "Canceled from the Vercel Dashboard" — tip SHA + live asset still match prior) |
| Live asset | `index-qV1VC2j2.js` | `index-qV1VC2j2.js` | **UNCHANGED** |
| `whisper-flow` | `5ab07d0` | `5ab07d0fdbe33aff315bed6ee4123f368d8bf53b` | **UNCHANGED** |
| `voice-cloning-studio` | `55d12ec` | `55d12ec97134a133185bef6be7da114613642afe` | **UNCHANGED** |
| `rea-features` (origin + local wt) | `e591f245` | `0715d6b1568b3edd2e23dfa7cd241b3b13b68768` | **CHANGED** — docs(rea): internal audit pass 2026-11-07m @ 2026-11-07T02:16:52Z (03:16:52 WAT) |
| compare `main`…`preview/integration` | 85 ahead / 311 behind | status=`diverged`, **ahead_by=85**, **behind_by=311**, total_commits=85, merge_base `714ad22` | **UNCHANGED** |
| compare `main`…`e3ccc51` | ahead 24 / behind 0 | status=`ahead`, **ahead_by=24**, **behind_by=0** | **UNCHANGED** |

Only tip movement this pass: **rea-features** advanced by the prior pass's docs commit. No prod/live/main/preview/pillar tip movement.

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

- Paginated branch list: **106** names (same count as 07l/07m).
- Tracked tips confirmed above.
- **No NEW branch** observed that moves a pillar or prod tip vs 07m.
- Sample present: `main`, `preview/integration`, `whisper-flow`, `voice-cloning-studio`, `rea-features`, `dashboard-3d*`, `fix/*`, `fleet/*`, `preview/*`, `visual-*`, `mcp-integration*`, `zapia/*` (page2).

## Production deployments (latest 3)

| id | sha | created_at (UTC → WAT) |
|----|-----|------------------------|
| 7592505183 | e3ccc51… | 2026-11-06T04:38:15Z → 2026-11-06 05:38:15 WAT |
| 7586826135 | 532ed14… | 2026-11-05T22:18:59Z → 2026-11-05 23:18:59 WAT |
| 7586772946 | 6e66e6f… | 2026-11-05T22:16:26Z → 2026-11-05 23:16:26 WAT |

## Live bundle

`curl` HTML → `index-qV1VC2j2.js` (also loads `https://grok.com/grok-app-builder/extensions.js` — known standing).
