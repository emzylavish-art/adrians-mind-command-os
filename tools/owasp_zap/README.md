# OWASP ZAP (passive baseline wrapper)

Read-only passive baseline for **Adrian's Mind** only.

## Engines (first match wins)
1. Local `zap-baseline.py` if installed
2. Docker image `ghcr.io/zaproxy/zaproxy:stable` with `zap-baseline.py`
3. In-repo passive probe (security headers, cookie flags, mixed-content markers)

**Active scan is disabled.** Host allowlist: `adrians-mind.vercel.app`, `localhost`, `127.0.0.1`.

Official source (registry): https://github.com/zaproxy/zaproxy

## Run
```bash
python3 tools/owasp_zap/zap_passive.py https://adrians-mind.vercel.app --out zap-passive.json
python3 -m unittest discover -s tools/owasp_zap -p 'test_*.py'
```
