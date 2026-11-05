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
