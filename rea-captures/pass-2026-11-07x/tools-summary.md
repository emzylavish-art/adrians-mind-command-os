# REA tools summary — pass-2026-11-07x

Product: **Adrian's Mind** (never Edurain). BlackEye excluded. Read-only; no app code edits; no commit.

Target: `https://adrians-mind.vercel.app`  
Worktree: `/workspace/rea-features-wt`  
Capture dir: `/workspace/rea-captures/pass-2026-11-07x/`  
Run time (Africa/Lagos): Sat Nov 7, 2026 ~05:31 WAT

---

## 1) GodEye (`tools/godeye/godeye.py`)

| Field | Value |
|-------|-------|
| Exit code | **0** |
| Engine | **requests** (Playwright/screenshot path unavailable; `screenshot_path: null`, no `godeye.png` written) |
| HTTP status | 200 |
| Title | Adrian's Mind |
| `button_count` | **69** (16 with visible text; rest empty-label) |
| `link_count` | **2** (`/explore`, `/login`) — sidebar nav is buttons, not anchors |
| `form_count` | 2 |
| `input_count` | 4 |
| `script_count` | 2 |
| `extensions.js` present? | **Yes** — `https://grok.com/grok-app-builder/extensions.js` |
| Other script | `/assets/index-qV1VC2j2.js` |
| Broken same-origin links | 0 (`/explore` 200, `/login` 200) |
| Console errors | 0 (requests engine; no live console) |
| Out | `godeye.json` |

Named buttons (sample): Close menu, Collapse sidebar, Search workspace, Library, Projects, Scheduled, New chat, Open Settings, Open menu, Switch voice mode, Model mode Auto…, Alerts, Dictate into composer, Open voice mode, Start voice (Ctrl+Shift+V).

---

## 2) OWASP ZAP passive (`tools/owasp_zap/zap_passive.py`)

| Field | Value |
|-------|-------|
| Exit code | **0** |
| Engine | **in-repo-passive-probe** (full OWASP ZAP daemon not installed; active scan disabled) |
| HTTP status | 200 |
| `findings_count` | **2** |
| Missing headers | **Content-Security-Policy**, **Permissions-Policy** |
| Present security headers | HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |
| Out | `zap-passive.json` |

Findings:
1. `missing_content_security_policy` (medium)
2. `missing_permissions_policy` (medium)

---

## 3) Offline help only (no URL / live scans)

### `python3 tools/rea/rea.py --help` — exit **0**
- Offline repository reconnaissance only (`path` directory).
- Flags: `--json`, `--out`. **No URL mode.** Do not invent live scans.

### `python3 tools/security_review/security_review.py --help` — exit **0**
- Offline static security review of repo-owned source only (`path` file/dir).
- Flags: `--json`, `--out`. **No URL mode.** Does not probe hosts. Do not invent live scans.

---

## 4) NEW vs known

**Known baseline (this pass):**
- OAuth×6 401 — *not re-probed by GodEye/ZAP in this run* (those tools do not hit OAuth providers)
- Missing CSP + Permissions-Policy — **confirmed** (ZAP findings_count=2)
- `extensions.js` present — **confirmed** (GodEye scripts)
- Sidebar buttons not anchors — **confirmed** (69 buttons, only 2 `<a>` links)

**NEW this pass:** **None** clearly new vs the known set. Same CSP/Permissions-Policy gaps, same extensions.js include, same button-heavy sidebar / sparse anchors. No additional ZAP findings beyond the two known missing headers. GodEye used requests fallback (no screenshot) — engine note only, not a product finding.

