# Blueprint diff — pass 2026-11-07v

Product: **Adrian's Mind Command OS** (never Edurain).  
Compare live site + branch tips vs pillars. States: `live` | `branch-only` | `partial` | `missing`.

| Pillar | State | Evidence | vs 07u |
|---|---|---|---|
| **Whisper Flow** | **branch-only** | Branch `whisper-flow` tip `5ab07d0`; `src/components/mind/whisper-flow` **200** on that ref, **404** on `main` / `preview/integration` / prod routes (`/whisper` 404). Live JS has no `whisper` string. | UNCHANGED |
| **Voice Cloning Studio** | **branch-only** | Branch `voice-cloning-studio` tip `55d12ec`; `src/components/mind/voice-cloning-studio` **200** only there. Live `/voice` 404; no VCS strings in primary bundle. | UNCHANGED |
| **Tool Registry (GodEye only; BlackEye excluded)** | **partial** | In-repo GodEye CLI OK against live (playwright). `tools/registry.json` on `main` lists God's Eyes implemented + BlackEye restricted. Live `/tools` **404**; `/api/mind/registry` **404**. GodEye upstream identity unconfirmed. BlackEye not run. | UNCHANGED |
| **Continuous evolution** | **partial** | REA internal audit loop continues (this pass). Many fleet/preview branches active; production tip still `e3ccc51` (main+24) lagging conceptual main `e4ed639`; preview/integration still 85 ahead / 311 behind main with auth/login fixes not on prod. Live asset hash unchanged. | UNCHANGED |

## Notes

- Main carries general voice UI (`voice-ui`, `live-voice-bar`, overlays) but **not** the Whisper Flow package directory nor VCS studio package.
- Sidebar deep destinations remain button-driven; deep path probes still 404 (Library/Projects/Scheduled/Tools/etc.).
- No pillar promoted to `live` this pass.

## TRUE NEW findings

**None.** All observed gaps match standing known list (OAuth×6 401, CSP+Permissions-Policy, sidebar/deep-link 404s, extensions.js, VCS/Whisper branch-only, audit example.com placeholders, GodEye upstream unconfirmed, prod lag, etc.).
