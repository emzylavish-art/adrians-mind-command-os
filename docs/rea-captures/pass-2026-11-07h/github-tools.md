# Method B+C — pass 2026-11-07h (2026-11-06 19:04 CST / 2026-11-07 02:04 WAT)

Product: **Adrian's Mind** / Adrian's Mind Command OS. READ-ONLY. BlackEye excluded. L1B3RT4S / identity-unconfirmed tools not run.

Repo: `emzylavish-art/adrians-mind-command-os`  
Worktree: `/workspace/rea-features-wt`  
Out: `/workspace/rea-captures/pass-2026-11-07h/`

## SHAs vs 07g baseline

| Ref | 07g baseline | 07h now | Status |
|---|---|---|---|
| origin/main | `e4ed639` | `e4ed639` | **UNCHANGED** |
| origin/preview/integration | `aa53aa0` (85 ahead / 311 behind main) | `aa53aa0` (diverged: 85 ahead / 311 behind) | **UNCHANGED** |
| Production tip (Deployments env=Production) | `e3ccc51` | `e3ccc51` | **UNCHANGED** |
| Live asset | `index-qV1VC2j2.js` | `index-qV1VC2j2.js` | **UNCHANGED** |
| whisper-flow | `5ab07d0` | `5ab07d0` | **UNCHANGED** |
| voice-cloning-studio | `55d12ec` | `55d12ec` | **UNCHANGED** |
| Local rea-features HEAD | `80f21c7` | `bbb3289` (`docs(rea): internal audit pass 2026-11-07g`) | **CHANGED** (docs-only; not live/prod) |

## Method B — cursor-github MCP

- `list_branches` (page 1, 100): main / preview/integration / whisper-flow / voice-cloning-studio / rea-features tips match table above. Page 2 includes `zapia/*` branches (e.g. `zapia/public-landing-private-workspace-20261106`, `zapia/settings-workspace-navigation-20261106`); no movement on tracked pillar/main/preview tips vs 07g.
- `list_commits` main tip: `e4ed639` — “Add GPT MCP proxy server…”
- `list_commits` preview/integration tip: `aa53aa0` — “Phase 5: harness MODEL_PROVIDER xai/openai…”
- `compare_commits` main...preview/integration: status=`diverged`, ahead_by=85, behind_by=311 (same as 07g).
- Production deployments (`gh api .../deployments?environment=Production&per_page=3`): tip sha `e3ccc51` (created 2026-11-06T04:38:15Z UTC → 2026-11-06 05:38 WAT).
- Live HTML: bundle `/assets/index-qV1VC2j2.js`; also loads `https://grok.com/grok-app-builder/extensions.js`.
- Pillar tips confirmed via branch list + `gh api` branches: whisper-flow `5ab07d0`, voice-cloning-studio `55d12ec`.

## Method C — tools + curl

| Tool | Exit | Key findings |
|---|---|---|
| `godeye.py --requests-only` | 0 → `godeye.json` | status 200; title Adrian's Mind; 69 buttons / 2 `<a>` links (`/explore`,`/login`); 0 broken same-origin anchors (nav is buttons); scripts: `extensions.js` + `index-qV1VC2j2.js`; note: upstream GodEye identity still unconfirmed |
| `zap_passive.py` | 0 → `zap-passive.json` | HSTS + XCTO + XFO + Referrer-Policy present; **still missing CSP + Permissions-Policy** (2 medium findings). In-repo passive probe (no ZAP daemon). |
| BlackEye | — | **excluded / not run** |
| L1B3RT4S / identity-unconfirmed | — | not run |
| rea.py / security_review | — | skipped (no URL mode) |

### Curl route probes

| Path | Status | Location |
|---|---|---|
| `/` | 200 | — |
| `/login` | 200 | — |
| `/dashboard` | 307 | `/login?next=%2Fdashboard` |
| `/memory` | 200 | — |
| `/explore` | 200 | — |
| `/tools` `/voice` `/artifacts` `/settings` `/activity` `/scheduled` | 404 | — |

### OAuth status probes (unauthenticated)

All six return **401** (unchanged):  
`/api/mind/oauth/{github,gmail,google_calendar,google_drive,notion,slack}/status`

Artifacts: `curl-probes.txt`, `live-index.html`, `live-asset.txt`, `godeye.json`, `zap-passive.json`.

## NEW findings vs 07g

**None.** All live/security findings are standing known gaps (OAuth×6 401; residual CSP+Permissions-Policy; sidebar button nav / deep-link 404s; extensions.js; GodEye upstream unconfirmed).

Only delta: local `rea-features` HEAD `80f21c7` → `bbb3289` (docs commit for prior pass 07g). No app/prod change.

## Bottom line

**Vs 07g baseline: essentially UNCHANGED on live/prod/tracked branches.** Sole CHANGE is local docs tip `bbb3289`. No new findings to route.
