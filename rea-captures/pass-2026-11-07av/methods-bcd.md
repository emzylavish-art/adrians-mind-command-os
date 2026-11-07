# REA Method B+C+D — pass 2026-11-07av
Product: **Adrian's Mind** / Adrian's Mind Command OS (never Edurain)  
Collected: 2026-11-07 ~10:13 WAT (Africa/Lagos)  
Mode: read-only internal lane; external lane paused; BlackEye / L1B3RT4S / identity-unconfirmed tools not run as scanners beyond allowed GodEye+ZAP wrappers.

Prior pass 07au tips for delta: main `b5d888d`, preview/integration `aa53aa0`, asset `index-ChogKXym.js`, whisper-flow `5ab07d0`, voice-cloning-studio `55d12ec`.

---

## B) GitHub — emzylavish-art/adrians-mind-command-os

### Branches
- **Count:** 108 (Link `rel=last` page=108 at per_page=1; list_branches page1=100 + page2=8)
- **whisper-flow:** exists — tip `5ab07d0` — **UNCHANGED** vs 07au
- **voice-cloning-studio:** exists — tip `55d12ec` — **UNCHANGED** vs 07au

### Tips (latest commits)
| Ref | SHA (short) | Message (abbrev) | vs 07au |
|-----|-------------|------------------|---------|
| main | `b5d888d` | Merge PR #23 OAuth MCP bridge + Astra/Sol/Luna routing MVP | **UNCHANGED** |
| preview/integration | `aa53aa0` | Phase 5 harness MODEL_PROVIDER xai/openai readiness probe | **UNCHANGED** |
| whisper-flow | `5ab07d0` | test(whisper-flow): wait for hydration after integration drawer UI | **UNCHANGED** |
| voice-cloning-studio | `55d12ec` | (tip match prior) | **UNCHANGED** |

main tip author date (GitHub): 2026-11-07T07:46:17Z → **2026-11-07 08:46:17 WAT**.

### compare_commits main...preview/integration
- status: **diverged**
- ahead_by (preview vs main): **85**
- behind_by: **320**
- total_commits in compare window: **85**

### tools/registry.json @ main
Fetched via cursor-github `get_file_contents`. Notable entries:
- **BlackEye:** status=`restricted`, install=`blocked`, live=`blocked` (EXCLUDED from runs)
- **God's Eyes:** status=`identity-unconfirmed`, install=`not-installed`, live=`not-connected` (upstream unconfirmed; in-repo `tools/godeye/godeye.py` still used as allowed GodEye wrapper)
- **REA:** implemented / callable-cli-and-ci
- **OWASP ZAP (registry):** source-verified / not-connected (in-repo `tools/owasp_zap/zap_passive.py` used)
- **L1B3RT4S:** source-verified / not-connected — **NOT RUN**
- Notes artifact: `registry-notes.json` (full JSON returned by MCP; empty placeholder `registry-main.json` not used)

### Open PRs (state=open, sort=updated desc) — 8 on page
| # | updated_at (UTC) | title | head |
|---|------------------|-------|------|
| 26 | 2026-11-07T09:02:39Z | Polish composer layout, empty states, and search keyboard focus | cursor/visual-polish-041b |
| 25 | 2026-11-07T08:39:27Z | Add production adrians-mind-mcp Worker config | cursor/prod-mcp-worker-de4c |
| 22 | 2026-11-06T18:21:34Z | Expose implemented runner capabilities through both MCP transports | fix/mcp-runner-tool-parity-20261106 |
| 12 | 2026-11-05T12:19:55Z | Pin voice and connection tools for the fleet | fleet/tools/voice-and-connection-pins |
| 9 | 2026-11-03T15:37:23Z | feat(functionality): real local agent dispatch and atomic workspace saves | chatgpt/functionality-persistence-2026-11-03 |
| 7 | 2026-11-03T05:23:45Z | visual/polish-pass-11 | visual/polish-pass-11 |
| 6 | 2026-11-03T04:36:30Z | visual(pass-10): stacking/overlap CSS + phone mobile structure | visual/polish-pass-10-stacking |
| 2 | 2026-11-01T23:11:21Z | feat: keystroke + voice intent predictor (client-side) | intent-predictor |

Saved: `open-prs.txt`, `compare-summary.txt`, `branch-count.txt`.

### Live deploy tip
- HTML asset: **`/assets/index-ChogKXym.js`** — **UNCHANGED** vs 07au  
  Also loads `https://grok.com/grok-app-builder/extensions.js` (known).
- Headers: HTTP/2 200, Vercel, HSTS, x-frame-options DENY, x-content-type-options nosniff; **no CSP / no Permissions-Policy** in response (see ZAP).
- Vercel `get_deployment` (user-Vercel--adrian) for `adrians-mind.vercel.app`:
  - id: `dpl_HmAxBEus6oL75hCkTuXE8NDSM9qF`
  - state/readyState: **READY** / production target
  - git: **main** @ `b5d888dd107c4a06de582a0e29fce551c95b01df`
  - createdAt: 2026-11-07 09:33:11 WAT | ready: 2026-11-07 09:52:18 WAT
  - aliases include `adrians-mind.vercel.app`

Artifacts: `live-headers.txt`, `live-index.html`, `live-asset.txt`.

---

## C) Repo tools (from /workspace/rea-features-wt)

| Tool | Command | Exit | Summary |
|------|---------|------|---------|
| GodEye | `python3 tools/godeye/godeye.py https://adrians-mind.vercel.app --screenshot .../godeye.png --out .../godeye.json` | **0** | engine=`requests`; title Adrian's Mind; status 200; 2 same-origin links (/explore,/login both 200); **69 buttons** (sidebar mostly buttons not anchors); scripts: extensions.js + index-ChogKXym.js; **screenshot=None** (no godeye.png; requests path); note: "in-repo implementation; upstream identity still unconfirmed" |
| ZAP passive | `python3 tools/owasp_zap/zap_passive.py ... --out .../zap-passive.json` | **0** | in-repo passive baseline (full ZAP daemon not installed); findings_count=**2**: `missing_content_security_policy` (medium), `missing_permissions_policy` (medium) |
| REA CLI | `tools/rea/rea.py --help` | **0** | offline repo recon help OK |
| security_review | `tools/security_review/security_review.py --help` | **0** | offline static review help OK |

BlackEye **not run**. L1B3RT4S **not run**. identity-unconfirmed tools **not run** as upstream.

Artifacts: `godeye.json`, `zap-passive.json`, `rea-help.txt`, `security-review-help.txt`.

---

## Live curl probes

### Routes
| Path | Status |
|------|--------|
| / | 200 |
| /login | 200 |
| /dashboard | 307 |
| /memory | 200 |
| /explore | 200 |
| /tools | **404** |
| /voice | **404** |
| /chat | **404** |
| /activity | **404** |

### OAuth status (`/api/mind/oauth/*/status`)
| Endpoint | Status |
|----------|--------|
| github | **401** |
| gmail | **401** |
| google_calendar | **401** |
| google_drive | **401** |
| notion | **401** |
| slack | **401** |

### Audit login domain
`REA_AUDIT_EMAIL` domain from `/home/box/.secrets/rea-audit-login.env`: **`example.com`** (password not printed).

Artifacts: `curl-routes.txt`, `curl-oauth.txt`.

---

## D) Blueprint pillar draft

Pillars vs live evidence (compare prior: all branch-only or partial — **still the same**):

| Pillar | Status | Evidence |
|--------|--------|----------|
| **Whisper Flow** | **branch-only / partial** | Branch `whisper-flow` @ `5ab07d0` exists; live shows voice-related buttons (Dictate/Open voice/Start voice) via GodEye but no confirmed Whisper Flow surface on production asset `index-ChogKXym.js`; `/voice` curl **404**. |
| **Voice Cloning Studio** | **branch-only / missing on live** | Branch `voice-cloning-studio` @ `55d12ec` exists; not present on live deploy (main@b5d888d / same asset). |
| **Tool Registry (GodEye only; BlackEye excluded)** | **partial** | In-repo GodEye wrapper callable (exit 0); registry still lists God's Eyes as **identity-unconfirmed**; BlackEye **restricted/blocked** (correct); many registry tools `not-connected`. |
| **Continuous evolution** | **partial** | 108 branches; open PRs #26/#25 updated today; main tip includes OAuth MCP merge; **live production asset unchanged** vs 07au (`index-ChogKXym.js`); preview/integration still diverged (ahead 85 / behind 320). |

---

## NEW_VS_KNOWN

Known list checked — **no status changes** that warrant a new flag:

- XAI_API_KEY unset — not re-probed this method (known; leave)
- 403/login fixes preview-only — unchanged (preview tip still aa53aa0)
- heavy-asset 404s branch-only — not revalidated here
- 11 sidebar deep-link 404s — GodEye confirms sidebar items are **buttons not anchors** (known)
- live-search env unset — not re-probed
- chat layout/⌘K/Artifacts — PR #26 still open (visual polish) — known track
- empty panels — known
- Voice Cloning Studio missing on live — **confirmed still**
- Cloudflare burner pending — not re-probed
- GodEye upstream unconfirmed — **confirmed** (tool note + registry)
- OAuth×6 401 — **confirmed still**
- residual CSP+Permissions-Policy — **confirmed still** (ZAP)
- sidebar buttons not anchors — **confirmed**
- extensions.js — **confirmed still**
- audit example.com placeholder — **confirmed**
- forbidden_cross_site — not re-probed this method
- explore TEMPLATE/NOT LIVE — /explore returns 200 (shell); content not deeply re-audited here
- Scheduled local-only — button present; known
- Universe hang intermittent — not re-probed
- Grok status honesty — not re-probed
- BlackEye restricted in registry — **confirmed**
- /tools /voice /chat /activity curl 404 — **confirmed still**

**NEW findings this pass:** none that change known gap status.  
**Observed activity (not new gaps):** open PRs #26 (visual polish) and #25 (prod MCP worker) updated 2026-11-07; production Vercel deploy is main@`b5d888d` READY.  
**Operational note:** GodEye screenshot path unused (`godeye.png` absent; requests engine).

---

## Delta vs 07au (tips / asset)
| Item | 07au | 07av | Flag |
|------|------|------|------|
| main | b5d888d | b5d888d | UNCHANGED |
| preview/integration | aa53aa0 | aa53aa0 | UNCHANGED |
| live asset | index-ChogKXym.js | index-ChogKXym.js | UNCHANGED |
| whisper-flow | 5ab07d0 | 5ab07d0 | UNCHANGED |
| voice-cloning-studio | 55d12ec | 55d12ec | UNCHANGED |

## Artifact paths
All under `/workspace/rea-captures/pass-2026-11-07av/`:
- `methods-bcd.md` (this file)
- `branch-count.txt`, `compare-summary.txt`, `open-prs.txt`, `registry-notes.json`
- `live-headers.txt`, `live-index.html`, `live-asset.txt`
- `curl-routes.txt`, `curl-oauth.txt`
- `godeye.json`, `zap-passive.json`, `rea-help.txt`, `security-review-help.txt`
