# REA pass 2026-11-07p — GitHub summary

Product: **Adrian's Mind** / Adrian's Mind Command OS (never Edurain).  
Repo: `emzylavish-art/adrians-mind-command-os`  
Sources: `gh` CLI (branches / commits / compare / Production deployments) + live HTML.  
Read-only. Captured ~2026-11-07 03:44 WAT (Africa/Lagos).  
Worktree: `/workspace/rea-features-wt` on `rea-features` @ `6729bb2`.

## Tip / asset rollup vs prior tips (task brief)

| Ref | Prior tip | 07p | Verdict |
|-----|-----------|-----|---------|
| `origin/main` | `e4ed639` | `e4ed639` | **UNCHANGED** |
| `origin/preview/integration` | `aa53aa0` | `aa53aa0` | **UNCHANGED** |
| Production deploy tip | `e3ccc51` | `e3ccc51` (created 2026-11-06T04:38:15Z → 2026-11-06 05:38:15 WAT) | **UNCHANGED** |
| Live asset | `index-qV1VC2j2.js` | `index-qV1VC2j2.js` | **UNCHANGED** |
| `whisper-flow` | `5ab07d0` | `5ab07d0` | **UNCHANGED** |
| `voice-cloning-studio` | `55d12ec` | `55d12ec` | **UNCHANGED** |
| compare `main`…`preview/integration` | 85 ahead / 311 behind | status=`diverged`, **ahead_by=85**, **behind_by=311**, merge_base `714ad22` | **UNCHANGED** |
| compare `main`…`e3ccc51` | ahead 24 / behind 0 | status=`ahead`, **ahead_by=24**, **behind_by=0** | **UNCHANGED** |
| `rea-features` (extra) | `aed3589` (07o) | `6729bb2` — docs(rea): internal audit pass 2026-11-07o @ 2026-11-07T02:38:12Z | **CHANGED** (docs-only; not a product tip) |

**Delta vs prior product tips:** **NONE.** main / preview/integration / Production / live asset / whisper-flow / voice-cloning-studio all **UNCHANGED**. Only `rea-features` advanced via prior-pass docs commit.

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
- Count: **106** (same as 07o / 07n).
- No NEW branch that moves a pillar or prod tip.
- Key tips: `main`=`e4ed639`, `preview/integration`=`aa53aa0`, `whisper-flow`=`5ab07d0`, `voice-cloning-studio`=`55d12ec`, `rea-features`=`6729bb2`.
- Related present: `voice-integration`=`9399e37`, `voice-wiring`=`9a1f554`, `fleet/voice-stream/pipeline`=`a53ed1b`, `fix/mcp-runner-tool-parity-20261106`=`2e1c27b`.

## Production deployments (latest 5)
| sha | environment | created_at (UTC → WAT) |
|-----|-------------|------------------------|
| e3ccc51 | Production | 2026-11-06T04:38:15Z → 2026-11-06 05:38:15 WAT |
| 532ed14 | Production | 2026-11-05T22:18:59Z → 2026-11-05 23:18:59 WAT |
| 6e66e6f | Production | 2026-11-05T22:16:26Z → 2026-11-05 23:16:26 WAT |
| 3e918b1 | Production | 2026-11-05T22:02:06Z → 2026-11-05 23:02:06 WAT |
| b36897a | Production | 2026-11-05T21:37:40Z → 2026-11-05 22:37:40 WAT |

Latest Preview deployments (not prod): `46d2d24`, `19d6475`, `2e1c27b` (2026-11-06 evening UTC).

## Live bundle
`curl` / GodEye → `/assets/index-qV1VC2j2.js` (+ `https://grok.com/grok-app-builder/extensions.js`).
