# Pass 2026-11-06d analysis (America/Chicago)

## GitHub
- origin/main `e4ed639` UNCHANGED (live source of truth for promoted code)
- origin/preview/integration `aa53aa0` UNCHANGED (compare: 85 ahead / 311 behind main; diverged)
- Production tip family still `e3ccc51` (zapia-isolated-auth / pc-approvals; main+24) — UNCHANGED vs 06c
- Branch noise only (not live): rea-features `004b688`; codex/mcp-oauth-mvp `46d2d24`; fix/mcp-runner-tool-parity `2e1c27b`; zapia/* recent; owner branches idle vs live

## Tools (read-only)
- godeye.py → status 200, 69 buttons, 0 broken same-origin anchors, extensions.js still loaded, upstream identity still unconfirmed
- zap_passive → XCTO/XFO/Referrer present; **missing CSP + Permissions-Policy** (known residual)
- rea.py + security_review.py offline OK; BlackEye excluded; L1B3RT4S / identity-unconfirmed skipped

## Live probes
- `/` `/login` `/memory` `/explore` 200; `/dashboard` 307→`/login?next=%2Fdashboard`
- Sidebar deep routes `/voice` `/tools` `/artifacts` `/settings` `/imagine` `/bots` → 404 (known)
- OAuth status×6 → 401 (known)

## Visual walk
- See visual-walk.md: Access denied on /dashboard; login form works; audit sign-in rejected once with mismatch copy; unsigned /memory /explore / OK

## NEW evidence (same auth blocker family)
- `/home/box/.secrets/rea-audit-login.env` REA_AUDIT_EMAIL uses placeholder domain **example.com** (local-part length 20). Login cannot succeed until a real audit account is provisioned and the secret is replaced. This root cause was not stated in 06a–06c reports.

## Pillars
| Pillar | State | Evidence |
|---|---|---|
| Whisper Flow | partial | live voice mode chip present (godeye/home); full flow on voice-wiring/whisper-flow branches |
| Voice Cloning Studio | branch-only | origin/voice-cloning-studio `55d12ec`; not on live nav |
| Tool Registry (GodEye only) | partial | GodEye in-repo tool; live tool registry incomplete; mcp-integration branch progress |
| Continuous evolution | partial | drafts/docs on main; fleet/logic branches not promoted |
