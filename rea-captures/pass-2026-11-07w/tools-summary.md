# Tools summary — pass 2026-11-07w

Target: https://adrians-mind.vercel.app  
Commands from tool-install-2026-11-03.md. BlackEye excluded; L1B3RT4S not run.

## godeye.py
- exit 0; engine **requests** (07v was playwright — run delta only; screenshot_path null this pass)
- 69 buttons; scripts include `extensions.js` + `index-qV1VC2j2.js`
- broken_same_origin_links: 0 (sidebar still buttons, not anchors)
- note: in-repo implementation; upstream identity still unconfirmed
- artifacts: godeye.json (png skipped under requests engine)

## zap_passive.py
- findings_count=2 — **still missing CSP + Permissions-Policy**
- XCTO / XFO / Referrer-Policy / HSTS present
- artifact: zap-passive.json

## rea.py / security_review.py
- offline `--help` only (no URL mode) — same as prior passes
