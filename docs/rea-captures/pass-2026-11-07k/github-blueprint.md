# REA pass 2026-11-07k — GitHub blueprint (Methods B/C)

Product: **Adrian's Mind** / Adrian's Mind Command OS (never Edurain).  
Repo: `emzylavish-art/adrians-mind-command-os`.  
Sources: `cursor-github` MCP (`list_commits`, `compare_commits`, `get_git_tree`, `get_file_contents`) + `gh` CLI (branches, Production deployments).  
Compared to prior tips from pass brief / 2026-11-07j.  
Read-only; no force-push/merge/app edits. Captured ~2026-11-07 02:48–02:50 Africa/Lagos.

## Tips — CHANGED vs UNCHANGED

| Ref | Tip (short) | Full SHA | vs prior |
|-----|-------------|----------|----------|
| `origin/main` | **e4ed639** | e4ed639814e63ba686c273ba4e9018b2740dde76 | **UNCHANGED** — "Add GPT MCP proxy server so Claude, Grok, and ChatGPT can call your OpenAI API" (2026-11-05T22:58:49Z) |
| `origin/preview/integration` | **aa53aa0** | aa53aa0ad54486d9af6649a1307c524c6c34527f | **UNCHANGED** — "Phase 5: harness MODEL_PROVIDER xai/openai…" (2026-11-03T06:18:24Z) |
| Production deployment (newest) | **e3ccc51** | e3ccc51f568ffb4942f155515041d8da469e298c | **UNCHANGED** — created 2026-11-06 05:38:15 Africa/Lagos (from 2026-11-06T04:38:15Z); next 532ed14 @ 2026-11-05T22:18:59Z, 6e66e6f @ 2026-11-05T22:16:26Z |
| Live asset | **index-qV1VC2j2.js** | `/assets/index-qV1VC2j2.js` | **UNCHANGED** |
| `whisper-flow` | **5ab07d0** | 5ab07d0fdbe33aff315bed6ee4123f368d8bf53b | **UNCHANGED** |
| `voice-cloning-studio` | **55d12ec** | 55d12ec97134a133185bef6be7da114613642afe | **UNCHANGED** |
| Compare `main...preview/integration` | diverged ahead **85** / behind **311** (total_commits 85; merge_base 714ad22) | — | **UNCHANGED** |
| Compare `main...e3ccc51` | status ahead; ahead_by **24** / behind_by **0** | — | **UNCHANGED** (prod tip is 24 commits ahead of main tip) |
| Local `rea-features` wt HEAD | **a56ebbc** | a56ebbc5ad2407b01192583653689e2f0faf02a3 | local tip moved (07j was f1de049; commit: docs(rea): internal audit pass 2026-11-07j); **not** a prod/live change. Origin `rea-features` also a56ebbc |

## Latest commits

**main** (cursor-github `list_commits`, 5):
1. e4ed639 — Add GPT MCP proxy server… (2026-11-05T22:58:49Z)
2. a2fe5b3 — Add clear run instructions for web app and team runner
3. 7b87fff — Add docs index listing all specifications and blueprints
4. d562f70 — Add Arcanum AI Security Resource Hub learning path
5. d6877f2 — Add Attack-Side Cybersecurity Blueprint starting from Linux foundations

**preview/integration** (5):
1. aa53aa0 — Phase 5: harness MODEL_PROVIDER xai/openai with one-token readiness probe
2. c1ee830 — fix(ui): phone drawer nav + honest Notion status
3. b84dcc2 — fix(auth): first-party Google/GitHub OAuth without supabase.co in the browser
4. 23860f7 — fix(auth): mutable OAuth callback redirect so Set-Cookie can merge
5. 518db93 — fix(login): keep Google/GitHub enabled on auth loader fallback

## Branches of note (gh list + pattern filter)

Present (sample): `main`, `preview/integration`, `whisper-flow`, `voice-cloning-studio`, `voice-integration`, `voice-wiring`, `rea-features`, `dashboard-3d*`, `fix/login-ui`, `fix/mcp-runner-tool-parity-20261106` (2e1c27b @ 2026-11-06T17:13:57Z — newest fix/* tip), `fix/nav-notion-status`, `fix/rea-hardening`, `logic-*`, `mcp-integration*`, `media-integration`, `media-storage-fleet`, many `preview/*`, `visual-*`.  
API returned 100 branches (paginated cap). No movement on pillar tips vs prior pass.

## Production deployments (`gh api …/deployments?environment=Production&per_page=3`)

1. e3ccc51 @ 2026-11-06T04:38:15Z (id 7592505183) → **05:38:15 Africa/Lagos**
2. 532ed14 @ 2026-11-05T22:18:59Z
3. 6e66e6f @ 2026-11-05T22:16:26Z

## High-level tree at `main` tip (get_git_tree recursive=false)

Top-level dirs/files include: `.devcontainer`, `.github`, `.handoff`, `AGENTS.md`, `ENGINEERING.md`, `agent`, `docs`, `mcp`, `migrations`, `policies`, `public`, `scripts`, `server`, `src`, `team`, `tools`, `upstream`, `vercel.json`, `vite.config.ts`, plus root docs (`RUN.md`, `VOICE_ROUND3_SPEAKING.md`, etc.). Truncated=false.

## tools/registry.json notes

- **main**: `"God's Eyes"` status=`identity-unconfirmed`, install=`not-installed`, live=`not-connected`; `"BlackEye"` status=`restricted` / blocked (excluded). REA entry `implemented` / callable-cli-and-ci.
- **rea-features wt** (local): God's Eyes listed `implemented` (branch-only registry drift vs main); BlackEye still restricted. Not live on prod.

## Explicit rollup

| Item | Verdict |
|------|---------|
| main tip | **UNCHANGED** (e4ed639) |
| preview/integration tip | **UNCHANGED** (aa53aa0) |
| prod tip | **UNCHANGED** (e3ccc51) |
| live bundle | **UNCHANGED** (index-qV1VC2j2.js) |
| whisper-flow | **UNCHANGED** (5ab07d0) |
| voice-cloning-studio | **UNCHANGED** (55d12ec) |
