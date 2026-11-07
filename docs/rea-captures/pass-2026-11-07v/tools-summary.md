# Tools summary — pass 2026-11-07v

Worktree: `/workspace/rea-features-wt` (branch `rea-features`)  
Commands from `/workspace/rea-captures/tool-install-2026-11-03.md`.  
BlackEye **excluded**. L1B3RT4S / identity-unconfirmed tools **not run**.

## GodEye (`tools/godeye/godeye.py`)

```
python3 tools/godeye/godeye.py https://adrians-mind.vercel.app \
  --out /workspace/rea-captures/pass-2026-11-07v/godeye.json \
  --screenshot /workspace/rea-captures/pass-2026-11-07v/godeye.png
```

- **exit 0**
- engine: **playwright** (07u was **requests** — tool-run delta only, not a product gap)
- status 200; title `Adrian's Mind`
- buttons=**69**; links=2; forms=2; inputs=10; scripts=2; styles=3
- console_error_count=0; broken_same_origin_count=0
- screenshot written: `godeye.png`
- scripts include `https://grok.com/grok-app-builder/extensions.js` + live `index-qV1VC2j2.js`
- registry note: God's Eyes `implemented` / upstream identity **still unconfirmed** — standing

## OWASP ZAP passive (`tools/owasp_zap/zap_passive.py`)

```
python3 tools/owasp_zap/zap_passive.py https://adrians-mind.vercel.app \
  --out /workspace/rea-captures/pass-2026-11-07v/zap-passive.json
```

- **exit 0**
- engine: `in-repo-passive-probe` (no ZAP daemon/docker)
- findings_count=**2** — **UNCHANGED**:
  1. `missing_content_security_policy` (medium)
  2. `missing_permissions_policy` (medium)
- XCTO / XFO / Referrer-Policy / HSTS present (same as 07u)

## REA / security_review

- `tools/rea/rea.py --help` — offline directory recon only (no URL mode) — help captured conceptually; not run against live URL
- `tools/security_review/security_review.py --help` — offline static review only — same

## Registry snapshot (worktree `tools/registry.json`)

| name | status | live |
|---|---|---|
| God's Eyes | implemented | callable-cli-and-ci |
| OWASP ZAP | implemented (passive-only) | callable-cli-and-ci |
| REA | implemented | callable-cli-and-ci |
| BlackEye | **restricted / blocked** | blocked — untouched |

## Tool exit highlights

- GodEye OK (playwright + screenshot)
- zap_passive still missing CSP + Permissions-Policy only
- OAuth×6 still 401 (live probe)
- No TRUE NEW tool findings beyond standing list
