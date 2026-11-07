# GitHub summary — REA pass 2026-11-07ao
Product: Adrian's Mind (Adrian's Mind Command OS)
Captured: 2026-11-07 ~08:58 Africa/Lagos (WAT)
Repo: emzylavish-art/adrians-mind-command-os
Method: cursor-github MCP + `git fetch --all --prune` in `/workspace/rea-features-wt`
Read-only.

## Tip SHAs (CHANGED vs prior tips)

| Ref | Prior tip | Current tip | Status |
|-----|-----------|-------------|--------|
| `main` | `e4ed639` | `b5d888d` (`b5d888dd107c4a06de582a0e29fce551c95b01df`) | **CHANGED** |
| `preview/integration` | `aa53aa0` | `aa53aa0` (`aa53aa0ad54486d9af6649a1307c524c6c34527f`) | UNCHANGED |
| prod tip (prior) `e3ccc51` | `e3ccc51` | `e3ccc51` (`e3ccc51f568ffb4942f155515041d8da469e298c`) still present on `zapia/pc-approvals-error-repair-2026-11-05` / `zapia-isolated-auth-20261104` | UNCHANGED (branch tip); **diverged from main** |
| live asset | `index-qV1VC2j2.js` | `index-qV1VC2j2.js` | UNCHANGED |
| `whisper-flow` | `5ab07d0` | `5ab07d0` (`5ab07d0fdbe33aff315bed6ee4123f368d8bf53b`) | UNCHANGED |
| `voice-cloning-studio` | `55d12ec` | `55d12ec` (`55d12ec97134a133185bef6be7da114613642afe`) | UNCHANGED |
| worktree `rea-features` HEAD | — | `bb63a37` | local audit docs tip |

**ANY tip changed: YES — `main` only** (moved e4ed639 → b5d888d).

### main move detail
Merge-base of `e3ccc51` vs `origin/main` is still `e4ed639`.
- `e3ccc51` ahead of main: **24**
- main ahead of `e3ccc51`: **9** (new MCP/OAuth worker commits)
- Neither is ancestor of the other (diverged).

New on main since `e4ed639` (abbrev):
- `b5d888d` Merge PR #23 `codex/mcp-oauth-mvp` — OAuth MCP bridge + Astra/Sol/Luna routing MVP
- `a19adbb` Merge PR #24 `cursor/worker-mcp-tools-de4c` — free authenticated Worker MCP entrypoint
- plus worker/OAuth edge harness commits (`fcab42b`, `30843aa`, `267dc39`, `34e0e8b`, `392eb14`, `46d2d24`, `19d6475`, …)

## Branches
- Paginated `list_branches` (100 + page 2). Notable tips match table above.
- `preview/integration` tip message still: Phase 5 harness MODEL_PROVIDER xai/openai (2026-11-03).

## compare_commits `main`…`preview/integration`
- status: **diverged**
- ahead_by: **85** / behind_by: **320** / total_commits: **85**
- files changed (page): **300**
- html: https://github.com/emzylavish-art/adrians-mind-command-os/compare/main...preview/integration
- Note: compare base_sha reported as current main `b5d888d` (after main move).

## get_git_tree `main` (non-recursive)
Top-level includes: `src`, `tools`, `workers`, `mcp`, `server`, `docs`, `agent`, `upstream`, `vercel.json`, etc. `tools/` present on main.

## tools/registry.json @ main
- Present. BlackEye: `restricted` / `blocked`. L1B3RT4S: research corpus / not-connected.
- "God's Eyes": `identity-unconfirmed`, `not-installed`, `not-connected`.
- In-repo GodEye CLI lives on `rea-features` worktree (`tools/godeye/`); **not** on `origin/main` tree paths `tools/godeye` / `tools/owasp_zap` (MISS on main; OK on rea-features wt).

## Pillar ancestry
- Whisper Flow tip `5ab07d0` **NOT** in main or `e3ccc51`.
- Voice Cloning Studio tip `55d12ec` **NOT** in main or `e3ccc51`.
- Whisper/VCS path counts on main and e3ccc51: **0**.
- `voice-cloning-studio` branch has `src/routes/voice-cloning-studio.tsx` + `src/lib/mind/voice-cloning/*`.
- `whisper-flow` branch has `src/lib/mind/whisper-flow/*` + bar component.

## Vercel (read-only)
- `user-Vercel` `list_projects` returned only: `oak-bridge-capital`, `app`, `tiktok-research-mcp` (team `team_l7Suz6H1IGwx6dnXAzzrWNhs`).
- **No `adrians-mind` project in this connector** — could not confirm production deployment SHA via Vercel API.
- Live confirmation instead: HTML asset still `index-qV1VC2j2.js`; prior prod tip `e3ccc51` still the documented deploy tip candidate (unchanged asset ⇒ live build unchanged).
