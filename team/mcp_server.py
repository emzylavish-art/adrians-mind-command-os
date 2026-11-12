#!/usr/bin/env python3
"""Minimal MCP stdio server for ready Mind Command OS tools."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "team"))
import runner  # noqa: E402

SERVER_INFO = {"name": "mind-command-os-tools", "version": "0.1.0"}
PROTOCOL_VERSION = "2025-03-26"


def validate_jsonrpc(message):
    """Validate the JSON-RPC envelope before dispatching an MCP method."""
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        raise ValueError("Invalid JSON-RPC request.")
    if not isinstance(message.get("method"), str) or not message["method"]:
        raise ValueError("JSON-RPC method is required.")
    if "id" in message and not (isinstance(message["id"], (str, int)) and not isinstance(message["id"], bool)):
        raise ValueError("JSON-RPC id must be a string or integer.")
    if "params" in message and not isinstance(message["params"], dict):
        raise ValueError("JSON-RPC params must be an object.")
    return message


def tool_specs(manifest):
    specs = []
    for tool in manifest.get("tools", []):
        if tool.get("status") != "ready":
            continue
        name = tool.get("id")
        if name == "rea.scan":
            description = "Inventory a source directory and report languages, dependencies, entrypoints, and review markers. Offline; does not execute scanned source."
            schema = {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "out": {"type": "string"},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 300},
                },
                "additionalProperties": False,
            }
        elif name == "security.scan":
            description = "Run offline heuristic static security review. Does not execute code or make network requests; human validation is required."
            schema = {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Owned or authorized source path."},
                    "out": {"type": "string"},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 300},
                },
                "additionalProperties": False,
            }
        elif name == "knowledge.search":
            description = "Search local Markdown and text knowledge files using offline lexical retrieval."
            schema = {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "query": {"type": "string", "minLength": 1},
                    "top_k": {"type": "integer", "minimum": 1, "maximum": 50},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 300},
                },
                "required": ["query"],
                "additionalProperties": False,
            }
        elif name == "team.health":
            description = "Return offline readiness for manifest entries and tool entrypoints. Does not test external services or credentials."
            schema = {"type": "object", "properties": {}, "additionalProperties": False}
        elif name == "team.agent.resolve":
            description = "Resolve a specialist prompt from the repository, or select by explicit capabilities. Returns prompt text and requirements; does not run model inference."
            schema = {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                    "task": {"type": "string"},
                    "capabilities": {"type": "array", "items": {"type": "string"}},
                    "context": {"type": "object"},
                },
                "additionalProperties": False,
            }
        elif name == "team.queue":
            description = "Manage local SQLite durable worker jobs. Pass action or operation. Queue records payloads only; it never executes queued jobs."
            schema = {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["enqueue", "claim", "complete", "fail", "list"]},
                    "operation": {"type": "string", "enum": ["enqueue", "claim", "complete", "fail", "list"]},
                    "db": {"type": "string"},
                    "task": {"type": "string"},
                    "payload": {"type": "object"},
                    "worker": {"type": "string"},
                    "worker_id": {"type": "string"},
                    "id": {"type": "string"},
                    "job_id": {"type": "string"},
                    "claim_token": {"type": "string", "minLength": 1},
                    "result": {"type": "object"},
                    "error": {"type": "string"},
                    "max_attempts": {"type": "integer", "minimum": 1, "maximum": 20},
                    "lease_seconds": {"type": "integer", "minimum": 5, "maximum": 3600},
                    "status": {"type": "string", "enum": ["queued", "claimed", "succeeded", "failed"]},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 1000},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 120},
                },
                "additionalProperties": False,
            }

        elif name == "mcp.remote":
            description = "Call an explicitly configured remote MCP server over HTTPS. Server and tool must be enabled/allowlisted in team/remote_mcp.json; bearer tokens are environment-only."
            schema = {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["list", "call"]},
                    "server": {"type": "string", "minLength": 1},
                    "tool": {"type": "string"},
                    "arguments": {"type": "object"},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 120}
                },
                "required": ["action", "server"],
                "additionalProperties": False
            }
        elif name == "team.worker":
            description = "Process at most one queued job using the worker's explicit allowlist. No arbitrary shell or code payloads are executed."
            schema = {
                "type": "object",
                "properties": {
                    "worker_id": {"type": "string", "minLength": 1},
                    "db": {"type": "string"},
                    "lease_seconds": {"type": "integer", "minimum": 5, "maximum": 3600},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 180},
                },
                "required": ["worker_id"],
                "additionalProperties": False,
            }
        elif name == "model.generate":
            description = "Generate text through an explicitly configured model route. Pass prompt or messages. Auto routing attempts Astra, then Sol, then Luna and records the selected provider."
            schema = {
                "type": "object",
                "properties": {
                    "provider": {"type": "string", "enum": ["astra", "sol", "luna", "openai", "auto", "grok", "openrouter", "ollama"]},
                    "prompt": {"type": "string"},
                    "messages": {"type": "array", "items": {"type": "object"}},
                    "model": {"type": "string"},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 300},
                    "stream": {"type": "boolean"},
                },
                "additionalProperties": False,
            }
        elif name == "notion.controller":
            description = "Search or retrieve Notion content through the repository controller. append-text is an explicit mutating operation and requires its own invocation."
            schema = {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["search", "retrieve-page", "retrieve-children", "append-text"]},
                    "query": {"type": "string"},
                    "id": {"type": "string"},
                    "text": {"type": "string"},
                    "page_size": {"type": "integer", "minimum": 1, "maximum": 100},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 120},
                },
                "required": ["action"],
                "additionalProperties": False,
            }
        else:
            continue
        specs.append({"name": name, "description": description, "inputSchema": schema})
    return specs


def call_tool(name, arguments, manifest):
    if name not in {spec["name"] for spec in tool_specs(manifest)}:
        return {"isError": True, "content": [{"type": "text", "text": f"Tool unavailable: {name}"}]}
    result = runner.invoke(name, arguments or {}, manifest)
    return {
        "isError": result["status"] != "ready",
        "content": [{"type": "text", "text": json.dumps(result, indent=2)}],
    }


def handle(message, manifest):
    validate_jsonrpc(message)
    method = message.get("method")
    request_id = message.get("id")
    if method == "notifications/initialized":
        return None
    if method == "initialize":
        return {
            "jsonrpc": "2.0", "id": request_id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": SERVER_INFO,
            },
        }
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": tool_specs(manifest)}}
    if method == "tools/call":
        params = message.get("params", {})
        if not isinstance(params.get("name"), str) or not params["name"]:
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": "tools/call requires a tool name."}}
        if "arguments" in params and not isinstance(params["arguments"], dict):
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": "tools/call arguments must be an object."}}
        result = call_tool(params.get("name", ""), params.get("arguments", {}), manifest)
        return {"jsonrpc": "2.0", "id": request_id, "result": result}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": request_id, "result": {}}
    return {
        "jsonrpc": "2.0", "id": request_id,
        "error": {"code": -32601, "message": f"Method not found: {method}"},
    }


def main():
    manifest = runner.load_manifest()
    for line in sys.stdin:
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                raise ValueError("JSON-RPC message must be an object")
            response = handle(message, manifest)
            if response is not None:
                sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
                sys.stdout.flush()
        except json.JSONDecodeError as exc:
            sys.stdout.write(json.dumps({
                "jsonrpc": "2.0", "id": None,
                "error": {"code": -32700, "message": str(exc)},
            }) + "\n")
            sys.stdout.flush()
        except ValueError as exc:
            sys.stdout.write(json.dumps({
                "jsonrpc": "2.0", "id": message.get("id") if isinstance(message, dict) else None,
                "error": {"code": -32600, "message": str(exc)},
            }) + "\n")
            sys.stdout.flush()
        except Exception as exc:
            sys.stdout.write(json.dumps({
                "jsonrpc": "2.0", "id": None,
                "error": {"code": -32603, "message": str(exc)},
            }) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
