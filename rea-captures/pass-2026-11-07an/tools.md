# Tools — pass 2026-11-07an (from /workspace/rea-features-wt @ 0055405)
| tool | exit | key result |
|---|---|---|
| tools/godeye/godeye.py | 0 | engine=requests; title "Adrian's Mind"; 200; links 2 (/explore, /login both 200); buttons 69; forms 2; inputs 4; scripts 2; console errors 0; broken same-origin 0; screenshot=None (no browser engine, so godeye.png not produced, same as am); note "upstream identity still unconfirmed" |
| tools/owasp_zap/zap_passive.py | 0 | in-repo passive baseline (ZAP daemon not installed, active scan disabled); 2 findings: missing_content_security_policy (medium), missing_permissions_policy (medium) |
| tools/rea/rea.py --help | 0 | offline repo recon CLI usage ok |
| tools/security_review/security_review.py --help | 0 | offline static review CLI usage ok |
BlackEye excluded; L1B3RT4S / identity-unconfirmed tools not run. GodEye summary is byte-identical to pass am.
