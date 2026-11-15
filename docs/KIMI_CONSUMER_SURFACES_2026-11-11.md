# Kimi consumer surfaces copied into Adrian OS

Sources checked 2026-11-11:

- https://moonshotai.github.io/kimi-code/
- https://moonshotai.github.io/kimi-code/en/guides/getting-started.html
- https://moonshotai.github.io/kimi-code/en/customization/mcp.html
- https://moonshotai.github.io/kimi-code/en/customization/plugins.html
- Installed CLI `@moonshot-ai/kimi-code` 2.5.3

Working login, not a password form:

- `/login` offers Kimi Code OAuth (device code) or a Kimi Platform API key.
- Device start: `POST https://auth.kimi.ai/api/oauth/device_authorization` with public client id `17e5f671-d194-4dfb-9706-5516cb48c098`.
- Probe returned HTTP 200 with `verification_uri` `https://www.kimi.ai/code/authorize_device`, plus `user_code` and `verification_uri_complete`.
- Poll: `POST https://auth.kimi.ai/api/oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`.
- Global hosts: oauth `https://auth.kimi.ai`, API `https://api.kimi.ai/coding/v1`, CDN `https://code.kimi.ai/kimi-code`.

MCP and plugins:

- User MCP file is `~/.kimi-code/mcp.json`. HTTP entries use `url`. SSE entries set `transport: "sse"`. stdio entries use `command`.
- OAuth MCP uses `/mcp-config login <server>`.
- Plugin marketplace URL is `{cdnBase}/plugins/marketplace` and requires the Kimi login token.
- Official plugins named in the docs: Kimi Datasource, Kimi Browser Extension, Kimi Computer Use.
- Plugin install from GitHub uses `/plugins install <github url>`.

Not claimed as running inside Vercel:

- Local stdio MCP, hooks, subagents, computer use, and browser-extension driving need the Kimi CLI or a paired machine. Adrian OS must not mark those as executed just because the login screen is present.
