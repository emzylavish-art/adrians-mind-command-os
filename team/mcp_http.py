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
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mcp_server import runner, handle, validate_jsonrpc  # noqa: E402
from oauth import OAuthError, OAuthManager  # noqa: E402


MAX_BODY_BYTES = 1_000_000


def make_handler(token, manifest, oauth=None):
    if not token and oauth is None:
        raise ValueError("MCP_AUTH_TOKEN is required; refusing to start without authentication.")

    class MCPHandler(BaseHTTPRequestHandler):
        server_version = "MindCommandMCP/0.1"

        def _send(self, status, payload=None, content_type="application/json", headers=None):
            body = b"" if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            if body:
                self.wfile.write(body)

        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/health":
                self._send(200, {"status": "ok"})
            elif path == "/.well-known/oauth-authorization-server" and oauth:
                self._send(200, oauth.metadata())
            elif path == "/.well-known/oauth-protected-resource" and oauth:
                self._send(200, oauth.protected_resource_metadata())
            elif path == "/oauth/authorize" and oauth:
                self._authorize(oauth)
            elif path == "/mcp":
                self._send(405, {"error": "GET SSE is not implemented; use JSON POST transport."})
            else:
                self._send(404, {"error": "Not found."})

        def _oauth_failure(self, exc):
            self._send(exc.status, {"error": exc.error, "error_description": exc.description})

        def _authorize(self, manager):
            query = parse_qs(urlparse(self.path).query, keep_blank_values=True)
            params = {key: values[-1] for key, values in query.items()}
            subject = ""
            if os.environ.get("MCP_TRUST_ACCESS_IDENTITY") == "1":
                subject = self.headers.get("Cf-Access-Authenticated-User-Email", "") or self.headers.get("X-Authenticated-User", "")
            if not subject and os.environ.get("MCP_ENV") == "development":
                subject = os.environ.get("MCP_OAUTH_DEV_SUBJECT", "")
            if not subject:
                self._send(401, {"error": "login_required", "error_description": "Cloudflare Access identity is required."})
                return
            try:
                location = manager.authorize(params, subject=subject)
            except OAuthError as exc:
                self._oauth_failure(exc)
                return
            self.send_response(302)
            self.send_header("Location", location)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

        def _form_body(self):
            content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if content_type != "application/x-www-form-urlencoded":
                self._send(415, {"error": "Content-Type must be application/x-www-form-urlencoded."})
                return None
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 1 or length > MAX_BODY_BYTES:
                    raise ValueError("Invalid form body length.")
                raw = self.rfile.read(length).decode("utf-8")
                return {key: values[-1] for key, values in parse_qs(raw, keep_blank_values=True).items()}
            except (ValueError, UnicodeDecodeError):
                self._send(400, {"error": "invalid_request", "error_description": "Invalid form body."})
                return None

        def do_POST(self):
            path = urlparse(self.path).path
            if path == "/oauth/token" and oauth:
                params = self._form_body()
                if params is None:
                    return
                try:
                    self._send(200, oauth.exchange(params))
                except OAuthError as exc:
                    self._oauth_failure(exc)
                return
            if path == "/oauth/revoke" and oauth:
                params = self._form_body()
                if params is None:
                    return
                oauth.revoke(params.get("token", ""))
                self._send(200, {})
                return
            if path != "/mcp":
                self._send(404, {"error": "Not found."})
                return
            auth = self.headers.get("Authorization", "")
            expected = "Bearer " + token
            authorized = bool(token) and hmac.compare_digest(auth.encode("utf-8"), expected.encode("utf-8"))
            if not authorized and oauth and auth.startswith("Bearer "):
                try:
                    oauth.validate(auth[7:], audience=oauth.audience)
                    authorized = True
                except OAuthError:
                    authorized = False
            if not authorized:
                self._send(401, {"error": "Unauthorized."}, headers={"WWW-Authenticate": 'Bearer realm="mind-mcp"'})
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
                validate_jsonrpc(message)
                response = handle(message, manifest)
            except json.JSONDecodeError as exc:
                self._send(400, {"jsonrpc": "2.0", "id": None,
                                 "error": {"code": -32700, "message": str(exc)}})
                return
            except ValueError as exc:
                self._send(400, {"jsonrpc": "2.0", "id": message.get("id") if isinstance(message, dict) else None,
                                 "error": {"code": -32600, "message": str(exc)}})
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
    oauth = None
    issuer = os.environ.get("MCP_OAUTH_ISSUER", "")
    if issuer:
        oauth = OAuthManager(issuer, audience=os.environ.get("MCP_OAUTH_AUDIENCE"), secret=os.environ.get("MCP_OAUTH_SECRET"))
        client_id = os.environ.get("MCP_OAUTH_CLIENT_ID", "")
        redirect_uris = [uri for uri in os.environ.get("MCP_OAUTH_REDIRECT_URIS", "").split(",") if uri]
        if client_id and redirect_uris:
            oauth.register_client(client_id, redirect_uris)
    handler = make_handler(token, manifest, oauth=oauth)
    server = ThreadingHTTPServer((host, port), handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
