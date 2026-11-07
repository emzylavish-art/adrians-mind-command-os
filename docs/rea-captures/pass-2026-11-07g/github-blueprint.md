# GitHub + blueprint — pass 2026-11-07g

Product: **Adrian's Mind** / Adrian's Mind Command OS (never Edurain).
Repo: `emzylavish-art/adrians-mind-command-os`
Worktree: `/workspace/rea-features-wt` (branch `rea-features`)
Captured: 2026-11-07 01:49:51 WAT (Africa/Lagos)
Methods: **B/C/D only** (no browser) — cursor-github MCP + `gh` CLI + curl homepage/routes/bundle scan.
Compared to last pass **2026-11-07f**.

## Branch / deployment tips

| Ref | SHA (short / full) | Message / note | vs 07f |
|---|---|---|---|
| origin/main | `e4ed639` / e4ed639814e63ba686c273ba4e9018b2740dde76 | Add GPT MCP proxy server… (2026-11-05T22:58:49Z) | **UNCHANGED** |
| origin/preview/integration | `aa53aa0` / aa53aa0ad54486d9af6649a1307c524c6c34527f | Phase 5: harness MODEL_PROVIDER… (2026-11-03T06:18:24Z) | **UNCHANGED** |
| Production deployment tip | `e3ccc51` / e3ccc51f568ffb4942f155515041d8da469e298c | fix(pc): fail closed on ephemeral hosted approvals; env=Production id 7592505183 created 2026-11-06T04:38:15Z | **UNCHANGED** |
| Live JS asset | `assets/index-qV1VC2j2.js` | from `https://adrians-mind.vercel.app/` HTML | **UNCHANGED** |
| whisper-flow | `5ab07d0` / 5ab07d0fdbe33aff315bed6ee4123f368d8bf53b | test(whisper-flow): wait for hydration… | **UNCHANGED** |
| voice-cloning-studio | `55d12ec` / 55d12ec97134a133185bef6be7da114613642afe | visual(vcs): polish engine-down empty card… | **UNCHANGED** |
| origin/rea-features | `80f21c7` / 80f21c734c1b7742da719e1655aca09ce08bccb7 | docs(rea): internal audit pass 2026-11-07f | **CHANGED (docs tip only)** — was `a5f969a` in 07f; **not** live/Production |
| worktree HEAD | `80f21c7` | matches origin/rea-features | docs tip only |

Noted key branches present (page 1 of list_branches): `main`, `preview/integration`, `rea-features`, `whisper-flow`, `voice-cloning-studio` (plus many fleet/visual/audit branches).

## Compare `main...preview/integration`

- status: **diverged**
- ahead_by: **85** (preview commits not in main)
- behind_by: **311** (main commits not in preview)
- total_commits: **85**
- base_sha: `e4ed639814e63ba686c273ba4e9018b2740dde76`
- merge_base: `714ad2240765788c0aa2db37e65a7962cf96ddf3`
- vs 07f: **UNCHANGED**
- Artifact: `compare-main-preview.json`

## Recent commits

### main (newest first)
- e4ed639 Add GPT MCP proxy server so Claude, Grok, and ChatGPT can call your OpenAI API
- a2fe5b3 Add clear run instructions for web app and team runner
- 7b87fff Add docs index listing all specifications and blueprints
- d562f70 Add Arcanum AI Security Resource Hub learning path
- d6877f2 Add Attack-Side Cybersecurity Blueprint starting from Linux foundations

### preview/integration (newest first)
- aa53aa0 Phase 5: harness MODEL_PROVIDER xai/openai with one-token readiness probe
- c1ee830 fix(ui): phone drawer nav + honest Notion status
- b84dcc2 fix(auth): first-party Google/GitHub OAuth without supabase.co in the browser
- 23860f7 fix(auth): mutable OAuth callback redirect so Set-Cookie can merge
- 518db93 fix(login): keep Google/GitHub enabled on auth loader fallback

## Production deployments (top)

Artifact: `deployments-prod.json`

| created_at (UTC) | SHA | id |
|---|---|---|
| 2026-11-06T04:38:15Z | e3ccc51… | 7592505183 ← tip |
| 2026-11-05T22:18:59Z | 532ed14… | 7586826135 |
| 2026-11-05T22:16:26Z | 6e66e6f… | 7586772946 |

Note: Production tip `e3ccc51` is **not** an ancestor of `origin/main` (lives on zapia/pc-approvals lanes). Same as 07f.

## Live asset confirmation

- Curl homepage → wrote `homepage.html` + `live-asset.txt`
- Extracted: **`assets/index-qV1VC2j2.js`** (**UNCHANGED** vs 07f)
- Also in shell: `/assets/styles-BTes9Ayn.css`, `/assets/routes-DJ6fWTpc.css`, third-party `https://grok.com/grok-app-builder/extensions.js`
- Live route probes (curl, no browser): `/` 200, `/login` 200, **`/voice` 404**, `/whisper` 404, `/whisper-flow` 404, `/tools` 404
- Bundle string scan of `index-qV1VC2j2.js`: no `whisper-flow` / `VoiceCloning` / `/voice` / GodEye / BlackEye markers

## tools/registry.json

Artifacts: `registry-main.json`, `registry-rea-features.json` (not identical; SHA256 differs).

### @ main (upstream / live baseline)
- **God's Eyes**: status `identity-unconfirmed`; install `not-installed`; live `not-connected`; category `unresolved`. **Upstream identity still unconfirmed.**
- **BlackEye**: status `restricted`; install/live `blocked`; guardrail no phishing/credential-collection. **EXCLUDED — not run.**
- OWASP ZAP: `source-verified` / live `not-connected`
- REA: `implemented` / `callable-cli-and-ci`
- L1B3RT4S: `source-verified` / `not-connected` — **not run** this pass

### @ rea-features (worktree / local only — not Production)
- **God's Eyes**: status `implemented`; install `repo-code-present`; live `callable-cli-and-ci`; category `read-only-web-audit`; entrypoint `tools/godeye/godeye.py`; note: *in-repo implementation; upstream identity still unconfirmed*
- **BlackEye**: still `restricted` / blocked (excluded)
- OWASP ZAP: `implemented` / `callable-cli-and-ci` with `tools/owasp_zap/zap_passive.py`
- Drift vs main: **worktree-only**; same pattern as 07f. Not a live delta.

## Blueprint pillar status

| Pillar | State | Evidence |
|---|---|---|
| **Whisper Flow** | **partial** (branch tip; not on live) | Branch `whisper-flow` @ `5ab07d0` has live-voice-bar / whisper-flow e2e scripts; commits still ahead of `preview/integration`. Not on Production `e3ccc51` / live bundle `index-qV1VC2j2.js`. `/whisper` + `/whisper-flow` → 404. **UNCHANGED** vs 07f. |
| **Voice Cloning Studio** | **branch-only** | Branch `voice-cloning-studio` @ `55d12ec` (docs/voice-cloning, studio e2e). `/voice` live → **404**. Not on main/Production. **UNCHANGED**. |
| **Tool Registry (GodEye only; BlackEye EXCLUDED)** | **partial** | main registry: God's Eyes `identity-unconfirmed`; BlackEye `restricted`/blocked (not run). In-repo GodEye on `rea-features` worktree only. Bundle has no GodEye markers. **UNCHANGED** for live/main. |
| **Continuous evolution** | **partial** | Internal audit lane active (this pass 07g); preview still diverged 85/311 vs main; Production tip + live asset unchanged; no new pillar merge to live. **UNCHANGED**. |

## UNCHANGED vs CHANGED vs NEW (vs 07f)

### UNCHANGED
- origin/main `e4ed639`
- origin/preview/integration `aa53aa0`
- Production tip `e3ccc51`
- Live asset `index-qV1VC2j2.js`
- whisper-flow `5ab07d0`
- voice-cloning-studio `55d12ec`
- compare main...preview: diverged **85 ahead / 311 behind**
- main registry GodEye = identity-unconfirmed; BlackEye = restricted
- All four pillar states (partial / branch-only / partial / partial)

### CHANGED
- origin/rea-features / worktree HEAD: `a5f969a` → **`80f21c7`** (docs commit for pass 07f). **Docs tip only — not live/Production.**

### NEW findings
- **None** for live/prod/main/preview SHAs, compare stats, live bundle, or pillar merge status.

## Artifacts in this pass dir
- `live-asset.txt`, `homepage.html`
- `compare-main-preview.json`, `deployments-prod.json`
- `registry-main.json`, `registry-rea-features.json`
- `github-blueprint.md` (this file)
- Pre-existing from parallel Method C (not re-run here per B/C/D scope note): `godeye.json`, `zap-passive.json`

## Guardrails observed
- Did **not** edit app code.
- Did **not** run BlackEye or L1B3RT4S.
- Did **not** commit.
- No browser used.
