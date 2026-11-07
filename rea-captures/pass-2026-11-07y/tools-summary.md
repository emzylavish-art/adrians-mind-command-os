# REA tools summary — pass-2026-11-07y

Product: **Adrian's Mind** (never Edurain). BlackEye excluded. L1B3RT4S not run. Read-only; no app code edits; no force-push.

Target: `https://adrians-mind.vercel.app`  
Worktree: `/workspace/rea-features-wt` (branch `rea-features` @ `e66ff76`)  
Capture dir: `/workspace/rea-captures/pass-2026-11-07y/`  
Run time (Africa/Lagos): 2026-11-07 05:47:48 WAT

---

## 1) GodEye (`tools/godeye/godeye.py`)

| Field | Value |
|-------|-------|
| Exit code | **0** |
| Engine | **playwright** |
| HTTP status | 200 |
| Title | Adrian's Mind |
| `button_count` | **69** |
| `link_count` | **2** (`/explore`, `/login`) — sidebar nav is buttons, not anchors |
| `form_count` | 2 |
| `input_count` | 10 |
| `script_count` | 2 |
| `extensions.js` present? | **Yes** — `https://grok.com/grok-app-builder/extensions.js` |
| Live JS | `/assets/index-qV1VC2j2.js` |
| Broken same-origin links | 0 |
| Console errors | 0 |
| `screenshot_path` | null (tool JSON); a `01-dashboard.png` also present in capture dir (not claimed as GodEye out) |
| Note | in-repo implementation; upstream identity still unconfirmed |
| Out | `godeye.json` |

Voice-related buttons observed: Dictate into composer; Voice mode; Start voice (Ctrl+Shift+V); Speak. No Voice Cloning Studio surface.

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

Findings:
1. `missing_content_security_policy` (medium)
2. `missing_permissions_policy` (medium)

---

## 3) Offline help only (no URL / live scans)

### `python3 tools/rea/rea.py --help` — exit **0**
- Offline repository reconnaissance only (`path` directory).
- Flags: `--json`, `--out`. **No URL mode.**

### `python3 tools/security_review/security_review.py --help` — exit **0**
- Offline static security review of repo-owned source only.
- Flags: `--json`, `--out`. **No URL mode.** Does not probe hosts.

Artifacts: `rea-help.txt`, `security_review-help.txt`.

---

## 4) NEW vs known (tools lane)

**Confirmed known:** CSP+Permissions-Policy missing; extensions.js; sidebar buttons not anchors; GodEye upstream unconfirmed.

**NEW this pass:** **None.**
