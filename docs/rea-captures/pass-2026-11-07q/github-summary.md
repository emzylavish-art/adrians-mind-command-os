# REA pass 2026-11-07q — GitHub summary

Product: **Adrian's Mind** / Adrian's Mind Command OS (never Edurain).  
Repo: `emzylavish-art/adrians-mind-command-os`  
Sources: cursor-github + `gh` CLI + live HTML.  
Read-only. Captured ~2026-11-07 03:52 WAT (Africa/Lagos).  
Worktree: `/workspace/rea-features-wt` on `rea-features` @ `db3cec0` (start of pass).

## Tip / asset rollup vs prior (07p)

| Ref | Prior (07p) | 07q | Verdict |
|-----|-------------|-----|---------|
| `origin/main` | `e4ed639` | `e4ed639` | **UNCHANGED** |
| `origin/preview/integration` | `aa53aa0` | `aa53aa0` | **UNCHANGED** |
| Production deploy tip | `e3ccc51` | `e3ccc51` (created 2026-11-06T04:38:15Z → 2026-11-06 05:38:15 WAT) | **UNCHANGED** |
| Live asset | `index-qV1VC2j2.js` | `index-qV1VC2j2.js` | **UNCHANGED** |
| `whisper-flow` | `5ab07d0` | `5ab07d0` | **UNCHANGED** |
| `voice-cloning-studio` | `55d12ec` | `55d12ec` | **UNCHANGED** |
| compare `main`…`preview/integration` | diverged 85 ahead / 311 behind | status=`diverged`, **ahead_by=85**, **behind_by=311**, merge_base `714ad22` | **UNCHANGED** |
| compare `main`…`e3ccc51` | ahead 24 / behind 0 | status=`ahead`, **ahead_by=24**, **behind_by=0** | **UNCHANGED** |

**Delta vs prior product tips:** **NONE.**

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
- First page listed via API (~100); tips match 07p for key product refs.
- Key tips: `main`=`e4ed639`, `preview/integration`=`aa53aa0`, `whisper-flow`=`5ab07d0`, `voice-cloning-studio`=`55d12ec`.

## Production deployments (latest 5)
| sha | environment | created_at (UTC → WAT) |
|-----|-------------|------------------------|
| e3ccc51 | Production | 2026-11-06T04:38:15Z → 2026-11-06 05:38:15 WAT |
| 532ed14 | Production | 2026-11-05T22:18:59Z → 2026-11-05 23:18:59 WAT |
| 6e66e6f | Production | 2026-11-05T22:16:26Z → 2026-11-05 23:16:26 WAT |
| 3e918b1 | Production | 2026-11-05T22:02:06Z → 2026-11-05 23:02:06 WAT |
| b36897a | Production | 2026-11-05T21:37:40Z → 2026-11-05 22:37:40 WAT |

## Live bundle
`curl` → `/assets/index-qV1VC2j2.js` (+ `https://grok.com/grok-app-builder/extensions.js` per GodEye).
