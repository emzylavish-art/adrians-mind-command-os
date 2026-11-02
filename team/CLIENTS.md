# MCP client integration

This repository exposes its ready tools through the same MCP tool names. Agent prompt
resolution is a separate tool; it returns a specialist's prompt and requirements but
does not run a model.

## Claude Code / stdio-capable MCP clients

The root `.mcp.json` declares the stdio server. Start the client with the repository
as its working directory and Python 3 available. The client launches the server process.

## Codex CLI

Add the following server entry to the Codex MCP configuration (for example, the
appropriate `config.toml` for the Codex installation):

```toml
[mcp_servers.mind-command-os-tools]
command = "python3"
args = ["team/mcp_server.py"]
cwd = "/absolute/path/to/adrians-mind-command-os"
```

Replace the working directory with the repository's actual path. This is a host
configuration example, not a command executed by this repository.

## Cloud or remote MCP clients

Use the authenticated HTTP transport in `team/mcp_http.py` only when the client
supports stateless MCP JSON POST requests:

- Endpoint: `https://<your-host>/mcp`
- Header: `Authorization: Bearer <secret>`
- Health: `https://<your-host>/health`

The server does not implement GET/SSE. Some hosted MCP clients require SSE or a
specific Streamable HTTP session mode; those clients need a compatible transport
adapter. The repository currently contains no deployed public endpoint.

## Ready tool inventory

- `rea.scan`
- `security.scan`
- `knowledge.search`
- `team.health`
- `team.queue`
- `team.worker`
- `team.agent.resolve`

Tool readiness is checked against `team/manifest.json`; reserved or restricted catalog
entries are not exposed as ready MCP tools.
