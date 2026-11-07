# GitHub summary — pass 2026-11-07y

Product: **Adrian's Mind** / Adrian's Mind Command OS. External lane: paused. Read-only.

Captured: 2026-11-07 ~05:47 WAT (Africa/Lagos)  
Repo: `emzylavish-art/adrians-mind-command-os`  
Source: cursor-github MCP (`list_branches`, `list_commits`, `compare_commits`, `get_git_tree`) + `gh api` Production deployments.

## Tip SHAs vs prior known

| Ref | Prior known | This pass | Delta |
|-----|-------------|-----------|-------|
| `main` | `e4ed639` | `e4ed639814e63ba686c273ba4e9018b2740dde76` | **UNCHANGED** |
| `preview/integration` | `aa53aa0` | `aa53aa0ad54486d9af6649a1307c524c6c34527f` | **UNCHANGED** |
| Production deploy tip | `e3ccc51` | `e3ccc51f568ffb4942f155515041d8da469e298c` | **UNCHANGED** |
| Live asset | `index-qV1VC2j2.js` | `index-qV1VC2j2.js` | **UNCHANGED** |
| `whisper-flow` | `5ab07d0` | `5ab07d0fdbe33aff315bed6ee4123f368d8bf53b` | **UNCHANGED** |
| `voice-cloning-studio` | `55d12ec` | `55d12ec97134a133185bef6be7da114613642afe` | **UNCHANGED** |

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
- ahead_by: **85** / behind_by: **311** / total_commits (ahead page): 85
- merge_base: `714ad2240765…`
- files_changed (API page): ~300

## Trees (recursive=false)

- `main` tree tip object: commit `e4ed639…` — top-level includes `tools/`, `src/`, `upstream/`, `mcp/`, `team/`, `policies/`, `.gitmodules`
- `preview/integration` tree tip object: commit `aa53aa0…` — top-level includes `fleet/`, `src/`, `wrangler.toml`; **no** top-level `tools/` on this shallow listing (tools live elsewhere / differ from main layout)

## Production

- Latest GitHub Deployment environment=Production: id `7592505183`, sha/ref `e3ccc51f568ffb4942f155515041d8da469e298c`, created `2026-11-06T04:38:15Z` (= 2026-11-06 05:38:15 WAT)
- Status sample: inactive / "Canceled from the Vercel Dashboard" (deployment record tip SHA still `e3ccc51`)
- Vercel MCP `list_deployments` with projectId=`adrians-mind` returned 404; Production tip taken from `gh api` deployments (matches prior pass).

## Optional: tools/registry.json @ main

- Present on main. BlackEye: `restricted` / `blocked`. God's Eyes: `identity-unconfirmed` / `not-connected` on **main** registry.
- Worktree `rea-features` registry differs: God's Eyes marked `implemented` with entrypoint `tools/godeye/godeye.py` (branch-local; not evidence of live upstream identity).

## Local worktree note

- `/workspace/rea-features-wt` on branch `rea-features` @ `e66ff76` (local tip; not a tracked production/main tip).

## NEW vs known (GitHub lane)

**No tip SHA changes.** No new branch-tip deltas vs known baseline.
