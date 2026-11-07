# GitHub — pass 2026-11-07an (cursor-github MCP, read-only)
Repo: emzylavish-art/adrians-mind-command-os (private; anonymous API returns 404)

## Branches
- page1 = 100 (Link rel=next), page2 = 6 → 106 total, no new branch names vs am
- main e4ed639 — "Add GPT MCP proxy server so Claude, Grok, and ChatGPT can call your OpenAI API" (2026-11-05 23:58 WAT) — UNCHANGED
- preview/integration aa53aa0 — "Phase 5: harness MODEL_PROVIDER xai/openai with one-token readiness probe" (2026-11-03 07:18 WAT) — UNCHANGED
- Production tip e3ccc51 = zapia/pc-approvals-error-repair-2026-11-05 = zapia-isolated-auth-20261104 — "fix(pc): fail closed on ephemeral hosted approvals" — UNCHANGED
- whisper-flow 5ab07d0 — UNCHANGED; voice-cloning-studio 55d12ec — UNCHANGED
- rea-features 0055405 (am pass docs commit)

## Compare
- main...e3ccc51: ahead 24 / behind 0, merge-base e4ed639, 11 files (local shallow git, matches MCP output) — UNCHANGED
- main...preview/integration: MCP compare returned a 1.3 MB diff (huge divergence; no merge base in the shallow local clone) — UNCHANGED standing state
- whisper-flow / voice-cloning-studio: no merge base with main in the shallow clone (branch-only histories)

## Tree spot check
- main: only tools/registry.json matches pillar patterns; no whisper / voice-cloning routes
- e3ccc51 routes: dashboard, explore, auth/callback, api/mind/{oauth,pc,pairing,mcp,media,turn,agent}; no /tools /whisper /voice-cloning routes
