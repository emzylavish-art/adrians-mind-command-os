#!/usr/bin/env python3
"""Explicitly configured remote MCP-over-HTTP client bridge.

Only named HTTPS endpoints from team/remote_mcp.json may be contacted.
Bearer tokens are read from environment variables and never returned or logged.
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "team" / "remote_mcp.json"
NAME_RE = re.compile(r"^[a-zA-Z0-9_.-]{1,80}$")
MAX_RESPONSE = 2_000_000


class RemoteMCPError(RuntimeError):
    pass


def load_config():
    try:
        data = json.loads(CONFIG.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"servers": {}}
    if not isinstance(data, dict) or not isinstance(data.get("servers", {}), dict):
        raise RemoteMCPError("Remote MCP config must contain an object named servers.")
    return data


def _server(name, config=None):
    if not isinstance(name, str) or not NAME_RE.fullmatch(name):
        raise RemoteMCPError("Invalid remote server name.")
    servers = (config or load_config()).get("servers", {})
    entry = servers.get(name)
    if not isinstance(entry, dict) or entry.get("enabled") is not True:
        raise RemoteMCPError(f"Remote MCP server is not explicitly enabled: {name}")
    url = entry.get("url")
    parsed = urllib.parse.urlparse(url or "")
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise RemoteMCPError("Remote MCP endpoint must be an HTTPS URL without embedded credentials.")
    token_env = entry.get("token_env")
    if token_env:
        if not NAME_RE.fullmatch(token_env):
            raise RemoteMCPError("Invalid token environment variable name.")
        token = os.environ.get(token_env)
        if not token:
            raise RemoteMCPError(f"Required credential environment variable is unset: {token_env}")
    else:
        token = None
    return url, token, entry


def _post(url, token, payload, timeout=30):
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise RemoteMCPError("Remote MCP response exceeded the 2 MB limit.")
            if response.status not in (200, 202):
                raise RemoteMCPError(f"Remote MCP returned HTTP {response.status}.")
    except urllib.error.HTTPError as exc:
        # Never include request headers or response bodies that could contain secrets.
        raise RemoteMCPError(f"Remote MCP returned HTTP {exc.code}.") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RemoteMCPError(f"Remote MCP request failed: {type(exc).__name__}.") from None
    if not raw:
        return None
    try:
        message = json.loads(raw)
    except json.JSONDecodeError:
        raise RemoteMCPError("Remote MCP returned invalid JSON.") from None
    if not isinstance(message, dict):
        raise RemoteMCPError("Remote MCP response must be a JSON object.")
    if message.get("error"):
        err = message["error"]
        raise RemoteMCPError(f"Remote MCP JSON-RPC error: {err.get('code', 'unknown')} {err.get('message', 'error')}")
    return message.get("result")


def _rpc(url, token, method, params=None, request_id=1, timeout=30):
    return _post(url, token, {
        "jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}
    }, timeout=timeout)


def list_tools(server_name, timeout=30):
    url, token, entry = _server(server_name)
    _rpc(url, token, "initialize", {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "mind-command-os-remote-bridge", "version": "0.1.0"},
    }, timeout=timeout)
    _post(url, token, {"jsonrpc": "2.0", "method": "notifications/initialized"}, timeout=timeout)
    result = _rpc(url, token, "tools/list", timeout=timeout)
    tools = result.get("tools", []) if isinstance(result, dict) else []
    allowed = entry.get("allowed_tools")
    if allowed is not None:
        if not isinstance(allowed, list) or not all(isinstance(x, str) for x in allowed):
            raise RemoteMCPError("allowed_tools must be a list of tool names.")
        tools = [tool for tool in tools if tool.get("name") in allowed]
    return {"server": server_name, "tools": tools, "count": len(tools)}


def call_tool(server_name, tool_name, arguments, timeout=30):
    if not isinstance(tool_name, str) or not NAME_RE.fullmatch(tool_name):
        raise RemoteMCPError("Invalid remote tool name.")
    if not isinstance(arguments, dict):
        raise RemoteMCPError("Remote tool arguments must be a JSON object.")
    url, token, entry = _server(server_name)
    allowed = entry.get("allowed_tools")
    if not isinstance(allowed, list) or tool_name not in allowed:
        raise RemoteMCPError("Tool is not in this server's explicit allowed_tools list.")
    _rpc(url, token, "initialize", {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "mind-command-os-remote-bridge", "version": "0.1.0"},
    }, timeout=timeout)
    _post(url, token, {"jsonrpc": "2.0", "method": "notifications/initialized"}, timeout=timeout)
    result = _rpc(url, token, "tools/call", {
        "name": tool_name, "arguments": arguments
    }, timeout=timeout)
    if not isinstance(result, dict):
        raise RemoteMCPError("Remote MCP tools/call returned an invalid result.")
    return {"server": server_name, "tool": tool_name, "result": result}


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["list", "call"])
    parser.add_argument("--server", required=True)
    parser.add_argument("--tool")
    parser.add_argument("--arguments", default="{}")
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()
    try:
        if args.action == "list":
            result = list_tools(args.server, args.timeout)
        else:
            if not args.tool:
                parser.error("call requires --tool")
            result = call_tool(args.server, args.tool, json.loads(args.arguments), args.timeout)
        print(json.dumps({"status": "ready", "result": result}, indent=2))
    except (RemoteMCPError, ValueError) as exc:
        print(json.dumps({"status": "blocked", "error": str(exc)}, indent=2))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
