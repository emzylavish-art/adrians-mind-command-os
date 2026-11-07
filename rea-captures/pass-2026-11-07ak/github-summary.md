# GitHub — pass 2026-11-07ak
Captured: 2026-11-07 08:05 WAT (Africa/Lagos)

## Tips vs pass 2026-11-07aj
| Ref | SHA | vs 07aj |
|---|---|---|
| origin/main | `e4ed639` | UNCHANGED |
| origin/preview/integration | `aa53aa0` | UNCHANGED (gh compare: diverged, 85 ahead / 311 behind main) |
| Production tip (no `Production` branch; tracked as `e3ccc51` on zapia-isolated-auth-20261104 / zapia/pc-approvals-error-repair-2026-11-05) | `e3ccc51` | UNCHANGED (24 ahead / 0 behind main) |
| Live asset | `index-qV1VC2j2.js` | UNCHANGED |
| origin/whisper-flow | `5ab07d0` | UNCHANGED |
| origin/voice-cloning-studio | `55d12ec` | UNCHANGED |
| origin/rea-features | `780b28f` | CHANGED tip only (docs/audit captures; was `2475bca` in 07aj summary / `1b6bf42` in 07ai branches.txt) — not a live gap |
| origin/deploy/dashboard-live | `00dea54` | UNCHANGED |
| origin/cursor/worker-mcp-tools-de4c | `fcab42b` | UNCHANGED vs 07aj record |

## Remote branch count
- **106** via `gh` paginated branches API — **UNCHANGED** vs 07aj (page1=100 + page2=6)
- No branches added or removed vs 07ai branches.txt
- Note: local `git branch -r` can show 108 including `origin/HEAD` + local `motion-local/...`; canonical count remains 106

## Recent commits (gh API)
### main (5)
```
e4ed639 Add GPT MCP proxy server so Claude, Grok, and ChatGPT can call your OpenAI API
a2fe5b3 Add clear run instructions for web app and team runner
7b87fff Add docs index listing all specifications and blueprints
d562f70 Add Arcanum AI Security Resource Hub learning path
d6877f2 Add Attack-Side Cybersecurity Blueprint starting from Linux foundations
```

### preview/integration (5)
```
aa53aa0 Phase 5: harness MODEL_PROVIDER xai/openai with one-token readiness probe
c1ee830 fix(ui): phone drawer nav + honest Notion status
b84dcc2 fix(auth): first-party Google/GitHub OAuth without supabase.co in the browser
23860f7 fix(auth): mutable OAuth callback redirect so Set-Cookie can merge
518db93 fix(login): keep Google/GitHub enabled on auth loader fallback
```

## Compares
- main...preview/integration: status=diverged, ahead_by=85, behind_by=311 — UNCHANGED
- main...e3ccc51 (Production tip): ahead_by=24, behind_by=0 — UNCHANGED

Artifacts: branches.txt, commits-main.txt, commits-preview.txt, compare.txt
