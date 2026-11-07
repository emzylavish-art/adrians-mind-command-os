# GitHub summary — pass 2026-11-07v

Repo: `emzylavish-art/adrians-mind-command-os`  
Sources: cursor-github MCP (`list_branches`, `get_branch`, `list_commits`, `compare_commits`) + `gh` CLI.  
Worktree `/workspace/rea-features-wt` is **shallow** — ahead/behind taken from GitHub compare API, not local `rev-list`.

## Tips vs pass 2026-11-07u

| Ref | SHA (short) | vs 07u |
|---|---|---|
| `origin/main` | `e4ed639` (`e4ed639814e63ba686c273ba4e9018b2740dde76`) | **UNCHANGED** |
| `origin/preview/integration` | `aa53aa0` (`aa53aa0ad54486d9af6649a1307c524c6c34527f`) | **UNCHANGED** |
| Production deploy tip | `e3ccc51` (`e3ccc51f568ffb4942f155515041d8da469e298c`) | **UNCHANGED** (GitHub Deployments env=Production, created 2026-11-06T04:38:15Z → **05:38 WAT**) |
| Live asset | `index-qV1VC2j2.js` | **UNCHANGED** |
| `whisper-flow` | `5ab07d0` | **UNCHANGED** |
| `voice-cloning-studio` | `55d12ec` | **UNCHANGED** |
| `rea-features` (worktree branch tip) | `3887191` | noted only |

Production tip is **main+24** (local/gh: `origin/main..e3ccc51` = 24 commits) — **UNCHANGED**.

## compare_commits `main...preview/integration`

- status: **diverged**
- ahead_by: **85** / behind_by: **311** — **UNCHANGED**
- total_commits reported: 85; files changed page: 300

## Recent commits (sample)

**main** (newest first):
1. `e4ed639` — Add GPT MCP proxy server so Claude, Grok, and ChatGPT can call your OpenAI API (2026-11-05T22:58:49Z → **2026-11-05 23:58 WAT**)
2. `a2fe5b3` — Add clear run instructions for web app and team runner
3. `7b87fff` — Add docs index listing all specifications and blueprints
4. `d562f70` — Add Arcanum AI Security Resource Hub learning path
5. `d6877f2` — Add Attack-Side Cybersecurity Blueprint starting from Linux foundations

**preview/integration**:
1. `aa53aa0` — Phase 5: harness MODEL_PROVIDER xai/openai with one-token readiness probe (2026-11-03T06:18:24Z → **07:18 WAT**)
2. `c1ee830` — fix(ui): phone drawer nav + honest Notion status
3. `b84dcc2` — fix(auth): first-party Google/GitHub OAuth without supabase.co in the browser
4. `23860f7` — fix(auth): mutable OAuth callback redirect so Set-Cookie can merge
5. `518db93` — fix(login): keep Google/GitHub enabled on auth loader fallback

## Pillar path evidence (contents API)

| Path | main | preview/integration | whisper-flow | voice-cloning-studio |
|---|---|---|---|---|
| `src/components/mind/whisper-flow` | 404 | 404 | **200** | 404 |
| `src/components/mind/voice-cloning-studio` | 404 | 404 | 404 | **200** |
| `tools/godeye/godeye.py` | 404 | 404 | 404 | 404 |
| `tools/registry.json` | **200** | 404 | 404 | 404 |

GodEye live CLI code lives on `rea-features` worktree (from earlier main tools bring-up), not on current `main` tip tree.

## Branches

`list_branches` page 1 returned 100 branches (more pages exist). Pillar branches present: `whisper-flow`, `voice-cloning-studio`, `preview/integration`, `main`, `rea-features`.

## Delta verdict

**GitHub/prod/live-asset: all UNCHANGED vs 2026-11-07u.** No TRUE NEW branch-tip or deploy-tip movement.
