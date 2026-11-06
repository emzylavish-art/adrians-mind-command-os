# Pass 2026-11-06g — Method B GitHub (America/Chicago)

Repo: `emzylavish-art/adrians-mind-command-os`  
Captured: Fri Nov 6, 2026 ~4:55 PM CST (Fri Nov 6, 2026 ~11:55 PM WAT)  
Via: cursor-github MCP (read-only)

## Tip SHAs vs pass 06f

| Ref | 06f | 06g | Delta |
|---|---|---|---|
| `origin/main` | `e4ed639` | `e4ed639` | **UNCHANGED** |
| `origin/preview/integration` | `aa53aa0` | `aa53aa0` | **UNCHANGED** |
| Production tip family (`zapia/pc-approvals-error-repair-2026-11-05`, `zapia-isolated-auth-20261104`) | `e3ccc51` (main+24) | `e3ccc51` (main+24, behind_by 0) | **UNCHANGED** |

### main tip commits (per_page 5)
1. `e4ed639` — Add GPT MCP proxy server so Claude, Grok, and ChatGPT can call your OpenAI API (2026-11-05T22:58:49Z → 11:58 PM WAT Nov 5)
2. `a2fe5b3` — Add clear run instructions for web app and team runner
3. `7b87fff` — Add docs index listing all specifications and blueprints
4. `d562f70` — Add Arcanum AI Security Resource Hub learning path
5. `d6877f2` — Add Attack-Side Cybersecurity Blueprint starting from Linux foundations

### preview/integration tip commits (per_page 5)
1. `aa53aa0` — Phase 5: harness MODEL_PROVIDER xai/openai with one-token readiness probe (2026-11-03)
2. `c1ee830` — fix(ui): phone drawer nav + honest Notion status
3. `b84dcc2` — fix(auth): first-party Google/GitHub OAuth without supabase.co in the browser
4. `23860f7` — fix(auth): mutable OAuth callback redirect so Set-Cookie can merge
5. `518db93` — fix(login): keep Google/GitHub enabled on auth loader fallback

## Compares

| base…head | status | ahead | behind | total_commits |
|---|---|---|---|---|
| `main`…`preview/integration` | diverged | 85 | 311 | 85 |
| `main`…`e3ccc51` (prod tip) | ahead | 24 | 0 | 24 |

Identical to 06f numbers.

## Branch noise (not live)

| Branch | 06f | 06g | Note |
|---|---|---|---|
| `rea-features` | `327dab3` | `4d9fd52` | tip moved (docs/audit branch) — not live |
| `zapia/public-landing-private-workspace-20261106` | `b437c78` | `b437c78` | unchanged |
| `zapia/settings-workspace-navigation-20261106` | `40b0c1f` | `40b0c1f` | unchanged |
| `backup/gpt-proxy-stdio-20261106` | `ed2a649` | `ed2a649` | unchanged |
| `fix/mcp-runner-tool-parity-20261106` | `2e1c27b` | `2e1c27b` | unchanged |
| `voice-cloning-studio` | `55d12ec` | `55d12ec` | still branch-only |
| `whisper-flow` | `5ab07d0` | `5ab07d0` | still branch-only |

Branches paginated (page 1 + page 2). No new live-relevant tip moves. Live asset still `index-qV1VC2j2.js`. No commit SHA exposed in HTML/meta.

## Light tree (main, recursive=false)

Top-level includes: `src`, `server`, `tools`, `public`, `docs`, `mcp`, `agent`, `team`, `upstream`, `vercel.json`, `vite.config.ts`, etc. (35 entries; truncated=false).

## tools/registry.json @ main (excerpt)

- **God's Eyes**: status `identity-unconfirmed`, install `not-installed`, live `not-connected` (upstream still unconfirmed; in-repo GodEye wrapper used for audits).
- **BlackEye**: `restricted` / blocked (excluded).
- **OWASP ZAP**: `source-verified`, live `not-connected` (in-repo passive wrapper used).
- **L1B3RT4S**: research corpus only — never wired for this pass.
