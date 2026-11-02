# Hosted MCP transport

The repository has two MCP transports:

- `team/mcp_server.py`: stdio transport for an MCP host that launches a process.
- `team/mcp_http.py`: stateless JSON-over-HTTP transport for a hosted service.

The HTTP server is authenticated and does not make the repository publicly callable by
itself. It requires a secret bearer token supplied as `MCP_AUTH_TOKEN` in the hosting
platform's secret manager. Do not commit the token or place it in a public URL.

## Container

Build the image from the repository root:

```bash
docker build -f Dockerfile.mcp -t mind-command-mcp .
```

Run it with a token supplied by your secret manager:

```bash
docker run --rm -p 8080:8080 \
  -e MCP_AUTH_TOKEN="$MCP_AUTH_TOKEN" \
  mind-command-mcp
```

- MCP endpoint: `POST /mcp`
- Health endpoint: `GET /health`
- Default port: `8080`
- Authentication: `Authorization: Bearer <token>`

The transport returns JSON-RPC JSON responses and HTTP 202 for notifications. It is
stateless and does not implement the optional GET/SSE stream or server-initiated
notifications. Connect only MCP clients that support the JSON POST transport. Use
TLS at the hosting platform/reverse proxy. Set a strong secret and rotate it if exposed.

## Deployment status

This adds deployable code and a container definition; it does not create a public
service, DNS name, or cloud deployment. A hosting target, secret, and deployment
authorization are still required. Local SQLite queue persistence is suitable for a
single persistent container volume; it is not shared durable storage for ephemeral
multi-instance serverless deployments.
