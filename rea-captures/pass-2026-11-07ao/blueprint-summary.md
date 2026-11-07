# Blueprint diff — pass 2026-11-07ao
Pillars: Whisper Flow · Voice Cloning Studio · Tool Registry (GodEye only; BlackEye excluded) · continuous evolution
Evidence: branch tips vs prod tip `e3ccc51` + live `index-qV1VC2j2.js` + main `b5d888d`

## Pillar table

| Pillar | Status | Evidence |
|--------|--------|----------|
| **Whisper Flow** | **branch-only** | Tip `origin/whisper-flow` = `5ab07d0` UNCHANGED. Paths under `src/lib/mind/whisper-flow/*` + bar component on that branch. **0** whisper paths on `main` or `e3ccc51`. Tip not ancestor of main/prod. Live index bundle: no `whisper` string. |
| **Voice Cloning Studio** | **missing (live) / branch-only** | Tip `origin/voice-cloning-studio` = `55d12ec` UNCHANGED. Has `src/routes/voice-cloning-studio.tsx` + `src/lib/mind/voice-cloning/*` + API status route. **Not** in main or prod tip. Live `/voice` → 404. Bundle: no voice-cloning hits. |
| **Tool Registry (GodEye only)** | **partial** | `tools/registry.json` on main: GodEye/"God's Eyes" = identity-unconfirmed / not-installed; BlackEye restricted/blocked (correct). In-repo GodEye CLI callable on **rea-features** wt (ran OK); not shipped on main tree paths. Live site has no GodEye product surface. Upstream GodEye identity **unconfirmed** (standing). |
| **Continuous evolution** | **partial / live lagging** | Main **advanced** today (`e4ed639`→`b5d888d`: OAuth MCP bridge + Worker MCP). Prod tip `e3ccc51` still diverged (24 ahead / 9 behind main); live asset **unchanged** `index-qV1VC2j2.js` ⇒ production not yet on new main. preview/integration still `aa53aa0`, heavily diverged (85 ahead / 320 behind). |

## Route presence (selected)

| Route / feature | main | e3ccc51 (prod tip) | preview/integration | whisper-flow | voice-cloning-studio | live HTTP |
|-----------------|------|-------------------|---------------------|--------------|----------------------|-----------|
| login/dashboard/explore/memory | yes | yes | yes | yes | yes | / 200; /login 200; /dashboard 307→login; /memory,/explore 200; |
| voice-cloning-studio route | no | no | no | no | **yes** | /voice 404 |
| whisper-flow lib | no | no | no | **yes** | — | not in live bundle |
| /tools /chat /activity | — | — | — | — | — | **404** |

## Continuous-evolution note (NEW vs prior tip set)
Main tip change is the only tip movement this pass. Live/prod asset hash unchanged ⇒ users still on prior build; new MCP/OAuth main work not reflected in production HTML asset.
