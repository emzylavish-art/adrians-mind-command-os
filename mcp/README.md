# GPT MCP Proxy Server

Lets Claude Desktop, Grok, ChatGPT, or Astra call your OpenAI API (chat + image generation).

## Setup

1. Install dependencies:
   ```bash
   pip install -r mcp/requirements.txt
   ```

2. Set your key:
   ```bash
   export OPENAI_API_KEY=sk-your-key-here
   ```

3. Run locally (stdio):
   ```bash
   python mcp/gpt_proxy_server.py
   ```

The repository `.mcp.json` already registers this original `gpt-proxy` server
alongside Adrian’s Mind tools. It is intentionally kept as a separate existing
server: the Mind runner and its allowlisted tools are not duplicated or
replaced. The process inherits `OPENAI_API_KEY` from the host environment; no
key belongs in the repository configuration.

The requirements pin MCP to the 1.x Server decorator API used by this original
implementation. MCP 2.x removes that API and will prevent the server from
starting.

## Connect to Claude Desktop

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "gpt-proxy": {
      "command": "python",
      "args": ["/full/path/to/mcp/gpt_proxy_server.py"],
      "env": {
        "OPENAI_API_KEY": "sk-your-key"
      }
    }
  }
}
```

## Connect to Grok

1. Run the server behind a public URL (ngrok or Cloudflare Tunnel).
2. Go to grok.com/connectors → New Connector → Custom.
3. Paste the public MCP URL.

## Connect to ChatGPT

Use Custom Connectors (availability depends on your plan) and point at a public URL of this server.

## Tools exposed

- `ask_gpt` — chat with any OpenAI model
- `generate_image` — DALL-E / GPT Image

Your OpenAI usage is billed to the key you provide.
