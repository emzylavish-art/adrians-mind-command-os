# Defensive security lab

This directory deliberately separates **local, authorized security research**
from the Adrian's Mind production application.

## ARTEX source

`artex/` is a pinned Git submodule of
[`jiwoochris/artex-global`](https://github.com/jiwoochris/artex-global), an
AGPL-3.0 project. It is supplied for source review and use against the local
lab only. It is **not deployed with this website**, exposed to the Internet, or
configured with a production target.

The submodule currently records commit `06b36d7219244c5e2b6467394f60eca160c785cf`.
Before each update, review its changelog and image checksum; do not use
unreviewed `latest` images for a tool that can execute network commands.

## Safe local lab

The lab target is OWASP Juice Shop, a deliberately vulnerable application.
It binds only to `127.0.0.1`, so no one else can reach it.

```bash
cd security-lab
docker compose -f docker-compose.juice-shop.yml up -d
# Open http://127.0.0.1:3000
```

To inspect ARTEX's configuration without adding any credentials:

```bash
cd security-lab/artex
cp .env.example .env
docker compose config
```

Do not commit the generated `.env`: it holds database and LLM credentials.
ARTEX itself must stay bound to `127.0.0.1`; its proxy port must never be
published to the Internet. Only use it after writing down the exact owned target,
test window, allowed techniques, and a rollback contact. This repository does
not contain a command that points ARTEX at production.

## Prompt-security alternative

The “God Mode” project in the screenshots is intended to defeat provider safety
controls, so it is not included. For this app, the useful defensive replacement
is a prompt-injection regression suite: adversarial inputs should be added as
fixtures for the app's own model routes, then tested in CI without removing
provider safeguards or granting tools extra permissions.
