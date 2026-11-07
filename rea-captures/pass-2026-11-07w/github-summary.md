# GitHub summary — pass 2026-11-07w

Repo: `emzylavish-art/adrians-mind-command-os`  
Sources: cursor-github MCP (`list_commits`, `compare_commits`) + `gh` CLI + local fetch in `/workspace/rea-features-wt` (shallow — ahead/behind from GitHub compare API).  
Captured: 2026-11-06 22:21 CST / 2026-11-07 05:21 WAT

## Tips vs pass 2026-11-07v

| Ref | SHA (short) | vs 07v |
|---|---|---|
| `origin/main` | `e4ed639` | **UNCHANGED** |
| `origin/preview/integration` | `aa53aa0` | **UNCHANGED** |
| Production deploy tip | `e3ccc51` (created 2026-11-06T04:38:15Z → **05:38 WAT**) | **UNCHANGED** |
| Live asset | `index-qV1VC2j2.js` | **UNCHANGED** |
| `whisper-flow` | `5ab07d0` | **UNCHANGED** |
| `voice-cloning-studio` | `55d12ec` | **UNCHANGED** |
| `rea-features` worktree HEAD | `c3b344c` | docs/local tip (not production) |

Production tip remains **main+24** relative to `origin/main` (tip `e3ccc51` ahead of `e4ed639` history as previously measured).

## compare_commits `main...preview/integration`

- status: **diverged**
- ahead_by: **85** / behind_by: **311** — **UNCHANGED**
- compare: https://github.com/emzylavish-art/adrians-mind-command-os/compare/main...preview/integration

## Recent commits (sample)

**main**: `e4ed639` GPT MCP proxy; `a2fe5b3` run instructions; `7b87fff` docs index  
**preview/integration**: `aa53aa0` Phase 5 harness MODEL_PROVIDER; `c1ee830` phone drawer/Notion status; `b84dcc2` first-party OAuth

## Branches note

Fleet/owner branches still present (`dashboard-3d*`, `error-banners`, `logic-*`, `mcp-integration`, `media-integration`, `voice-*`, `visual/*`, `preview/*`, etc.). No tip movement on main/preview/integration/pillars vs 07v.
