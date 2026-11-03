# GodEye (God's Eyes)

In-repo **read-only** visual and structural auditor for Adrian's Mind URLs.
Upstream third-party identity remains unconfirmed; this does **not** download
any external "GodEye/God's Eye" binary or repository.

## Behavior
- Fetches with Playwright headless when available, else `requests`
- Captures title, status, links, buttons, forms, inputs, script/style assets
- Console errors and screenshot when Playwright is available
- Checks HTTP status of same-origin links (GET/HEAD only)
- **Never** submits forms or issues POSTs
- Host allowlist: `adrians-mind.vercel.app`, `localhost`, `127.0.0.1`

## Run
```bash
python3 tools/godeye/godeye.py https://adrians-mind.vercel.app --out godeye.json
python3 tools/godeye/godeye.py https://adrians-mind.vercel.app --screenshot /tmp/godeye.png --out godeye.json
python3 tools/godeye/godeye.py https://adrians-mind.vercel.app --requests-only --out godeye.json
python3 -m unittest discover -s tools/godeye -p 'test_*.py'
```

Use only against owned/authorized hosts on the allowlist.
