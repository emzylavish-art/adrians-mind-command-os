#!/usr/bin/env python3
"""Tiny local MCP stdio server exposing manifest-listed Mind Command tools.

Implements JSON-RPC 2.0 initialize, tools/list, and tools/call over newline-delimited
stdio. This is a minimal MCP-compatible transport, not a full model or agent host.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "team"))
import runner  # noqa: E402


SERVER_INFO = {"name": "mind-command-os-tools", "version": "0.1.0"}
PROTOCOL_VERSION = "2025-03-26"


def tool_specs(manifest):
    specs = []
    for tool in manifest.get("tools", []):
        if tool.get("status") != "ready":
            continue
        tool_id = tool.get("id")
        if tool_id == "rea.scan":
            specs.append({
                "name": tool_id,
                "description": "Inventory a source directory and report languages, dependencies, entrypoints, and review markers. Offline; does not execute scanned source.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Directory or file path, relative to repository root unless absolute."},
                        "out": {"type": "string", "description": "Optional output file path."},
                        "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 300},
                    },
                    "additionalProperties": False,
                },
            })
        elif tool_id == "security.scan":
            specs.append({
                "name": tool_id,
                "description": "Perform an offline heuristic static security review of source files. Does not execute code or make network requests; findings require human validation.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Authorized source directory or file, relative to repository root unless absolute."},
                        "out": {"type": "string", "description": "Optional output file path."},
                        "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 300},
                    },
                    "additionalProperties": False,
                },
            })
        elif tool_id == "team.queue":
            specs.append({
                "name": tool_id,
                "description": "Manage durable local SQLite worker jobs. Queue records payloads only and never executes jobs. Use worker_id to claim/complete/fail jobs.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "operation": {"type": "string", "enum": ["enqueue", "claim", "complete", "fail", "list"]},
                        "db": {"type": "string", "description": "Optional SQLite database path; defaults to team/queue.sqlite3."},
                        "task": {"type": "string"},
                        "payload": {"type": "object"},
                        "worker_id": {"type": "string"},
                        "job_id": {"type": "string"},
                        "result": {"type": "object"},
                        "error": {"type": "string"},
                        "max_attempts": {"type": "integer", "minimum": 1, "maximum": 20},
                        "lease_seconds": {"type": "integer", "minimum": 5, "maximum": 3600},
                        "status": {"type": "string", "enum": ["queued", "claimed", "succeeded", "failed"]},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 1000},
                        "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 120},
                    },
                    "required": ["operation"],
                    "additionalProperties": False,
                },
            })
        elif tool_id == "knowledge.search":
            specs.append({
                "name": tool_id,
                "description": "Search local Markdown and text knowledge files using offline lexical retrieval. Requires a query; no remote store is contacted.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Local knowledge directory or file."},
                        "query": {"type": "string", "minLength": 1},
                        "top_k": {"type": "integer", "minimum": 1, "maximum": 50},
                        "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 300},
                    },
                    "required": ["query"],
                    "additionalProperties": False,
                },
            })
        elif tool_id == "team.health":
            specs.append({
                "name": tool_id,
                "description": "Return an offline readiness report for the agent manifest and tool entrypoints. Does not test external providers or credentials.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            })
        elif tool_id == "team.queue":
            specs.append({
                "name": tool_id,
                "description": "Operate the local SQLite durable task queue. Enqueued payloads are stored as data only and are never executed by this tool.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "enum": ["enqueue", "claim", "complete", "fail", "list"]},
                        "task": {"type": "string"},
                        "payload": {"type": "object"},
                        "worker": {"type": "string"},
                        "id": {"type": "string"},
                        "result": {"type": "object"},
                        "error": {"type": "string"},
                        "max_attempts": {"type": "integer", "minimum": 1, "maximum": 20},
                        "lease_seconds": {"type": "integer", "minimum": 5, "maximum": 3600},
                        "status": {"type": "string", "enum": ["queued", "claimed", "succeeded", "failed"]},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 1000},
                        "db": {"type": "string"},
                    },
                    "required": ["action"],
                    "additionalProperties": False,
                },
            })
        elif tool_id == "team.health":
            specs.append({
                "name": tool_id,
                "description": "Return an offline readiness report for manifest-listed agents and tool entrypoints. Does not probe external services.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 60},
                    },
                    "additionalProperties": False,
                },
            })
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
        except Exception as exc:
            sys.stdout.write(json.dumps({
                "jsonrpc": "2.0", "id": None,
                "error": {"code": -32603, "message": str(exc)},
            }) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
