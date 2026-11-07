# Tools summary — pass 2026-11-07ae (read-only, https://adrians-mind.vercel.app only)
Worktree /workspace/rea-features-wt (rea-features 1c7d745). BlackEye / L1B3RT4S / identity-unconfirmed tools NOT run.

| Tool | Command | Exit | Result |
|---|---|---|---|
| GodEye | tools/godeye/godeye.py URL --screenshot godeye.png --out godeye.json | 0 | requests engine, 200, title "Adrian's Mind"; no screenshot produced (Playwright not used); content identical to 07ad |
| ZAP passive | tools/owasp_zap/zap_passive.py URL --out zap-passive.json | 0 | 2 findings: missing CSP (medium), missing Permissions-Policy (medium) — identical to 07ad |
| REA CLI | tools/rea/rea.py --help | 0 | rea-help.txt |
| Security Review | tools/security_review/security_review.py --help | 0 | secrev-help.txt |

Live probes (live-probe.txt): / 200, /login 200, /dashboard 307→/login?next=%2Fdashboard, /memory 200, /explore 200; /tools /voice /chat /activity /library /projects /scheduled 404; OAuth status github/gmail/google_calendar/google_drive/notion/slack all 401.
Headers (home-headers.txt): HSTS, X-Content-Type-Options nosniff, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin present; CSP + Permissions-Policy absent.
Live asset: assets/index-qV1VC2j2.js (live-asset.txt).
