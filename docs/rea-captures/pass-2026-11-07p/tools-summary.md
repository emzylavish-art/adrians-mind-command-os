# REA pass 2026-11-07p — tools summary

Product: **Adrian's Mind** / Adrian's Mind Command OS (never Edurain).  
Target: https://adrians-mind.vercel.app only. BlackEye excluded. L1B3RT4S not run.  
Read-only; no app code edits. Worktree: `/workspace/rea-features-wt` on `rea-features` @ `6729bb2`.  
Compared to prior tips + pass **2026-11-07o**.

## Exit codes

| Tool | Command | Exit |
|------|---------|------|
| GodEye | `python3 tools/godeye/godeye.py https://adrians-mind.vercel.app --screenshot …/godeye.png --out …/godeye.json` | **0** |
| ZAP passive | `python3 tools/owasp_zap/zap_passive.py https://adrians-mind.vercel.app --out …/zap-passive.json` | **0** |
| REA | `python3 tools/rea/rea.py --help` (brief offline; no URL mode) | **0** |

Skipped: BlackEye (excluded). L1B3RT4S / identity-unconfirmed unsafe tools. Active ZAP.

## GodEye (`godeye.json` + `godeye.png`)
- Engine: **playwright**; status **200**; title **Adrian's Mind**; final_url `/`
- button_count: **69**; link_count: **2** (`/explore`, `/login`); form_count: 2; input_count: **10**
- script_count: 2; style_count: 3; console_error_count: **0**; broken_same_origin_count: **0**
- same_origin_link_statuses: `/explore`→200, `/login`→200
- Scripts: `https://grok.com/grok-app-builder/extensions.js`, `/assets/index-qV1VC2j2.js`
- Screenshot: `/workspace/rea-captures/pass-2026-11-07p/godeye.png` (present)
- Note: in-repo implementation; upstream identity still unconfirmed
- vs 07o: **UNCHANGED** (counts / asset / scripts / broken=0)

## ZAP passive (`zap-passive.json`)
- Engine: in-repo-passive-probe; status **200**; findings_count: **2**
- **Headers present:** HSTS (`max-age=63072000; includeSubDomains; preload`); `x-content-type-options: nosniff`; `x-frame-options: DENY`; `referrer-policy: strict-origin-when-cross-origin`
- **Headers missing:** Content-Security-Policy (medium); Permissions-Policy (medium) — known
- vs 07o / known: **UNCHANGED**

## REA (offline help only)
- `rea.py` is offline directory reconnaissance (no external URL mode). `--help` exit 0.
- Not used for live product findings this pass.

## Live probes (also `live-probes.txt` / `live-asset.txt`)
| Check | 07p | vs prior |
|-------|-----|----------|
| `/` `/login` `/memory` `/explore` | 200 | UNCHANGED |
| `/dashboard` | 307 → `/login?next=%2Fdashboard` | UNCHANGED |
| `/tools` `/voice` `/artifacts` `/settings` `/activity` `/scheduled` `/library` `/projects` | 404 | UNCHANGED |
| OAuth status ×6 | all **401** | UNCHANGED |
| Live JS | `index-qV1VC2j2.js` | UNCHANGED |
| extensions.js | still loaded from grok.com | UNCHANGED |
| CSP / Permissions-Policy | still missing | UNCHANGED |

## NEW findings vs known list
**None.**
