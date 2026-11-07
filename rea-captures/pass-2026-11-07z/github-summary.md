# GitHub summary — pass 2026-11-07z

Product: **Adrian's Mind** / Adrian's Mind Command OS. External lane: paused. Read-only.

Captured: 2026-11-07 ~06:03 WAT (Africa/Lagos)  
Repo: `emzylavish-art/adrians-mind-command-os`  
Source: cursor-github MCP (`list_branches`, `list_commits`×2, `compare_commits`, `get_commit`×2) + `gh api` Production deployments. Vercel MCP skipped usable result (empty/404; same as pass y).

## Tip SHAs vs prior baseline (pass y)

| Ref | Prior known | This pass | Delta |
|-----|-------------|-----------|-------|
| `main` | `e4ed639` | `e4ed639814e63ba686c273ba4e9018b2740dde76` | **UNCHANGED** |
| `preview/integration` | `aa53aa0` | `aa53aa0ad54486d9af6649a1307c524c6c34527f` | **UNCHANGED** |
| Production deploy tip | `e3ccc51` | `e3ccc51f568ffb4942f155515041d8da469e298c` | **UNCHANGED** |
| Live asset | `index-qV1VC2j2.js` | `index-qV1VC2j2.js` | **UNCHANGED** |
| `whisper-flow` | `5ab07d0` | `5ab07d0fdbe33aff315bed6ee4123f368d8bf53b` | **UNCHANGED** |
| `voice-cloning-studio` | `55d12ec` | `55d12ec97134a133185bef6be7da114613642afe` | **UNCHANGED** |
| local `rea-features` wt | `5e2e0ac` | `5e2e0acf96d8a69eecacd4db774a2f87b78263d0` | **UNCHANGED** |

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
- files_changed (API page): ~300
- html: https://github.com/emzylavish-art/adrians-mind-command-os/compare/main...preview/integration

**UNCHANGED** vs pass y (still 85 ahead / 311 behind).

## Branches

- `list_branches` page 1 (per_page=100): includes `main`, `preview/integration`, `rea-features`, `whisper-flow`, `voice-cloning-studio`, many `visual/polish-*`, `fleet/*`, `chatgpt/*`, etc. Link header indicates page 2 exists. Tip SHAs for watched refs match baseline.

## Production

- Latest GitHub Deployment environment=Production: id `7592505183`, sha/ref `e3ccc51f568ffb4942f155515041d8da469e298c`, created `2026-11-06T04:38:15Z` (= 2026-11-06 05:38:15 WAT)
- user-Vercel `list_deployments`/`list_projects` with search/`app=adrians-mind` returned empty; tip taken from `gh api` (same method as pass y).

## NEW vs known (GitHub lane)

**No tip SHA changes.** No new branch-tip deltas vs known baseline.
