# Tools — pass 2026-11-07ak
Worktree: /workspace/rea-features-wt  
Commands from /workspace/rea-captures/tool-install-2026-11-03.md  
Captured: 2026-11-07 08:05 WAT (Africa/Lagos)

| Tool | Exit | Result |
|---|---|---|
| godeye.py (read-only vs live) | 0 | broken_same_origin_count=0; engine=requests; screenshot=None; note=upstream identity still unconfirmed; title=Adrian's Mind; status=200 |
| zap_passive.py | 0 | findings_count=2 — missing_content_security_policy + missing_permissions_policy (XCTO/XFO/Referrer-Policy/HSTS present) — UNCHANGED |
| rea.py | 0 | --help only (no URL mode) → rea-help.txt |
| security_review.py | 0 | --help only → security_review-help.txt |
| BlackEye | n/a | **excluded / not run** |
| L1B3RT4S / Blackbox / identity-unconfirmed | n/a | **not run** |

Artifacts: godeye.json, godeye.stdout.txt, godeye.err (empty), zap-passive.json, zap.stdout.txt, zap.err (empty), rea-help.txt, security_review-help.txt
