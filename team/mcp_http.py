#!/usr/bin/env python3
"""Authenticated stateless HTTP transport for the Mind Command OS MCP tools.

Set MCP_AUTH_TOKEN before starting. This server is designed for container/cloud
hosting; it does not expose a public endpoint by itself.
"""
import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mcp_server import runner, handle  # noqa: E402


MAX_BODY_BYTES = 1_000_000


def make_handler(token, manifest):
    if not token:
        raise ValueError("MCP_AUTH_TOKEN is required; refusing to start without authentication.")

    class MCPHandler(BaseHTTPRequestHandler):
        server_version = "MindCommandMCP/0.1"

        def _send(self, status, payload=None, content_type="application/json"):
            body = b"" if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if body:
                self.wfile.write(body)

        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/health":
                self._send(200, {"status": "ok"})
            elif path == "/mcp":
                self._send(405, {"error": "GET SSE is not implemented; use JSON POST transport."})
            else:
                self._send(404, {"error": "Not found."})

        def do_POST(self):
            if urlparse(self.path).path != "/mcp":
                self._send(404, {"error": "Not found."})
                return
            auth = self.headers.get("Authorization", "")
            expected = "Bearer " + token
            if not hmac.compare_digest(auth.encode("utf-8"), expected.encode("utf-8")):
                self._send(401, {"error": "Unauthorized."})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._send(400, {"error": "Invalid Content-Length."})
                return
            if length < 1 or length > MAX_BODY_BYTES:
                self._send(413 if length > MAX_BODY_BYTES else 400,
                           {"error": "Request body must be 1..1000000 bytes."})
                return
            content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if content_type != "application/json":
                self._send(415, {"error": "Content-Type must be application/json."})
                return
            try:
                message = json.loads(self.rfile.read(length))
                if not isinstance(message, dict):
                    raise ValueError("JSON-RPC message must be an object.")
                response = handle(message, manifest)
            except (json.JSONDecodeError, ValueError) as exc:
                self._send(400, {"jsonrpc": "2.0", "id": None,
                                 "error": {"code": -32700, "message": str(exc)}})
                return
            if response is None:
                self._send(202, None)
            else:
                self._send(200, response)

        def log_message(self, fmt, *args):
            # Avoid writing request headers, tokens, or payloads to default logs.
            return

    return MCPHandler


def main():
    token = os.environ.get("MCP_AUTH_TOKEN", "")
    manifest = runner.load_manifest()
    host = os.environ.get("MCP_HOST", "0.0.0.0")
    port = int(os.environ.get("MCP_PORT", "8080"))
    handler = make_handler(token, manifest)
    server = ThreadingHTTPServer((host, port), handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
