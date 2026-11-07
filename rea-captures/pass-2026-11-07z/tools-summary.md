# REA tools summary — pass-2026-11-07z

Product: **Adrian's Mind** (never Edurain). BlackEye excluded. L1B3RT4S not run. Read-only; no app code edits; no commit.

Target: `https://adrians-mind.vercel.app`  
Worktree: `/workspace/rea-features-wt` (branch `rea-features` @ `5e2e0ac`)  
Capture dir: `/workspace/rea-captures/pass-2026-11-07z/`  
Run time (Africa/Lagos): 2026-11-07 06:03 WAT

---

## 1) GodEye (`tools/godeye/godeye.py`)

| Field | Value |
|-------|-------|
| Exit code | **0** |
| Engine | **requests** (Playwright Python module not installed this env; chromium cache present but unused) |
| HTTP status | 200 |
| Title | Adrian's Mind |
| `button_count` | **69** |
| `link_count` | **2** (`/explore`, `/login`) — sidebar nav is buttons, not anchors |
| `form_count` | 2 |
| `input_count` | 4 (requests parse; prior playwright pass reported 10) |
| `script_count` | 2 |
| `extensions.js` present? | **Yes** — `https://grok.com/grok-app-builder/extensions.js` |
| Live JS | `/assets/index-qV1VC2j2.js` |
| Broken same-origin links | 0 |
| Console errors | n/a (requests engine) |
| `screenshot_path` | **null** (Playwright-only; `--screenshot …/godeye.png` not written) |
| Note | in-repo implementation; upstream identity still unconfirmed |
| Out | `godeye.json` |

Voice-related buttons observed: Dictate into composer; Open voice mode; Start voice (Ctrl+Shift+V); Switch voice mode. No Voice Cloning Studio surface.

Vs pass y: same exit 0 / title / button_count 69 / extensions.js / live asset. Engine fell back to **requests** (y had playwright) — env drift only, not a product change.

---

## 2) OWASP ZAP passive (`tools/owasp_zap/zap_passive.py`)

| Field | Value |
|-------|-------|
| Exit code | **0** |
| Engine | **in-repo-passive-probe** (full OWASP ZAP daemon not installed; active scan disabled) |
| HTTP status | 200 |
| `findings_count` | **2** |
| Missing headers | **Content-Security-Policy**, **Permissions-Policy** |
| Present | HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |
| Out | `zap-passive.json` |

Findings (UNCHANGED vs y):
1. `missing_content_security_policy` (medium)
2. `missing_permissions_policy` (medium)

---

## 3) Offline help only (no URL / live scans)

### `python3 tools/rea/rea.py --help` — exit **0**
- Offline repository reconnaissance only (`path` directory).
- Flags: `--json`, `--out`. **No URL mode.**
- Artifact: `rea-help.txt`

### `python3 tools/security_review/security_review.py --help` — exit **0**
- Offline static security review of repo-owned source only.
- Flags: `--json`, `--out`. **No URL mode.** Does not probe hosts.
- Artifact: `security-review-help.txt`

---

## 4) NEW vs known (tools lane)

**Confirmed known:** CSP+Permissions-Policy missing; XCTO/XFO/Referrer/HSTS present; extensions.js; sidebar buttons not anchors; GodEye upstream unconfirmed; live asset `index-qV1VC2j2.js`.

**NEW this pass (product):** **None.**

**Env note (not a product finding):** GodEye used `requests` this pass (Playwright module absent); screenshot not produced.
