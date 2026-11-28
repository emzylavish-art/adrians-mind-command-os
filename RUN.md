# How to Run Adrian's Mind Command OS

## Prerequisites
- Node.js 22+
- Python 3.12+
- Git

## 1. Clone and install

```bash
git clone https://github.com/emzylavish-art/adrians-mind-command-os.git
cd adrians-mind-command-os
npm install
```

Copy environment file and fill in secrets (never commit real values):

```bash
cp .env.example .env
# Edit .env with your XAI_API_KEY, SUPABASE keys, Notion token, etc.
```

## 2. Run the web app (main UI)

```bash
npm run dev
```

Open http://localhost:8080

## 3. Run the AI team runner (Python)

From the repository root:

```bash
python team/runner.py --task '{"operation":"list-tools"}'
```

Run team tests:

```bash
python -m unittest discover -s team -p 'test_*.py'
```

Start the MCP stdio server:

```bash
python team/mcp_server.py
```

## 4. Optional: Codespaces / Dev Container

Open the repo in GitHub Codespaces. The `.devcontainer/devcontainer.json` will set up Node 22 + Python 3.12 automatically.

## 5. Key documents

- Specs and blueprints: [docs/README.md](docs/README.md)
- Decision Model + Self-Improving Skills: [docs/decision-model-and-self-improving-skills-spec.md](docs/decision-model-and-self-improving-skills-spec.md)
- Team runner details: [team/README.md](team/README.md)

## Notes
- Secrets stay in `.env` only. Do not commit them.
- The team runner does not require extra pip packages for basic operation (stdlib only for the core tools).
- Full readiness of external tools depends on credentials and adapters being configured.

## Managed browser integration

The managed browser is available from Chat, Build, Speak, Tools, and Browser Settings when an isolated worker is configured. Start the worker with `npm run browser:worker` on a sandbox-capable Linux host with Node 24 and Playwright Chromium installed. Keep the worker listener private. Give it outbound DNS and HTTPS access only, with private and infrastructure networks denied, and put a private TLS proxy in front of its loopback port when the app runs on a different host.

Set `ADRIAN_MANAGED_BROWSER_ORIGINS` to the same comma-separated public HTTPS origins on the app and the worker. Give both the same strong server-only `ADRIAN_MANAGED_BROWSER_TOKEN`. Point the app at the private proxy using `ADRIAN_MANAGED_BROWSER_URL`. A loopback HTTP endpoint is available for local work. Apply migrations `0028_managed_browser.sql` and `0029_managed_browser_controls.sql` before enabling the worker. If the earlier candidate worker is running in an isolated environment, stop it before switching the app to the new worker. The migration retains earlier receipts and marks unfinished sessions for reconciliation.

Use a disposable integration environment to verify consent, screenshot capture, takeover, same-origin link navigation, scrolling, handback, and closing. Try a second signed-in account, stop control, an expired session, and a worker restart. The app retains action receipts and reconciles uncertain state explicitly. Temporary conversations keep personal browser activity in memory. The worker keeps pages for at most 15 minutes and holds no saved sign-ins. The personal browser is the path for account sign-ins, CAPTCHA, uploads, forms, and downloads.
