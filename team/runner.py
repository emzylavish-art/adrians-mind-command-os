#!/usr/bin/env python3
"""Mind Command OS shared JSON task runner."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "team" / "manifest.json"
ROUTER = ROOT / "team" / "router.py"


def load_manifest():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def envelope(status, result=None, evidence=None, limitations=None, dispatch=None):
    return {
        "status": status, "result": result, "evidence": evidence or [],
        "limitations": limitations or [], "dispatch": dispatch,
    }


def list_tools(manifest):
    return envelope(
        "ready", manifest.get("tools", []), ["team/manifest.json"],
        ["Catalog declarations do not prove external runtimes or services are connected."],
    )


def invoke(tool_id, payload, manifest):
    declared = {item.get("id"): item for item in manifest.get("tools", [])}
    tool = declared.get(tool_id)
    if tool is None:
        return envelope("blocked", limitations=[f"Tool is not declared: {tool_id}"])
    if tool.get("status") != "ready":
        return envelope(
            "blocked", evidence=[f"team/manifest.json#tools/{tool_id}"],
            limitations=[f"Tool status is {tool.get('status')}; invocation is disabled."],
        )

    if tool_id == "notion.controller":
        action = payload.get("action")
        if action not in {"search", "retrieve-page", "retrieve-children", "append-text"}:
            return envelope("blocked", limitations=["Notion action must be search, retrieve-page, retrieve-children, or append-text."])
        command = [sys.executable, str(ROOT / "tools" / "notion" / "controller.py"), action,
                   "--timeout", str(payload.get("timeout_seconds", 30))]
        if action == "search":
            query = payload.get("query")
            if not isinstance(query, str) or not query.strip():
                return envelope("blocked", limitations=["Notion search requires a non-empty query."])
            command.extend(["--query", query])
        else:
            page_id = payload.get("id")
            if not isinstance(page_id, str) or not page_id.strip():
                return envelope("blocked", limitations=["Notion action requires an id."])
            command.extend(["--id", page_id])
            if action in {"retrieve-children"}:
                command.extend(["--page-size", str(payload.get("page_size", 100))])
            if action == "append-text":
                text = payload.get("text")
                if not isinstance(text, str) or not text.strip():
                    return envelope("blocked", limitations=["append-text requires non-empty text."])
                command.extend(["--text", text])
        try:
            completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True,
                                       timeout=int(payload.get("timeout_seconds", 30)) + 5, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return envelope("blocked", limitations=[f"Notion invocation failed: {type(exc).__name__}."])
        output = completed.stdout or completed.stderr
        try:
            result = json.loads(output)
        except json.JSONDecodeError:
            return envelope("blocked", limitations=["Notion controller returned invalid JSON."])
        if completed.returncode != 0 or "error" in result:
            return envelope("blocked", result=result, evidence=["tools/notion/controller.py"],
                            limitations=["Notion request was not successful. Check token permissions and integration sharing."])
        return envelope("ready", result, ["tools/notion/controller.py"],
                        ["Notion access requires NOTION_API_KEY and page/database sharing. append-text is a write operation and only runs when explicitly requested."])

    if tool_id == "model.generate":
        provider = payload.get("provider", "auto")
        prompt = payload.get("prompt")
        messages = payload.get("messages")
        if messages is None:
            if not isinstance(prompt, str) or not prompt.strip():
                return envelope("blocked", limitations=["model.generate requires prompt or messages."])
            messages = [{"role": "user", "content": prompt}]
        if not isinstance(messages, list) or not messages:
            return envelope("blocked", limitations=["messages must be a non-empty list."])
        if provider not in {"astra", "sol", "luna", "openai", "grok", "openrouter", "ollama", "auto"}:
            return envelope("blocked", limitations=["provider must be astra, sol, luna, openai, auto, grok, openrouter, or ollama."])
        command = [sys.executable, str(ROOT / "team" / "provider_router.py"), "--prompt", json.dumps(messages)]
        if provider == "auto":
            command.append("--route")
        else:
            command.extend(["--provider", provider])
        if payload.get("model"):
            command.extend(["--model", str(payload["model"])])
        if payload.get("stream") is True:
            command.append("--stream")
        command.extend(["--timeout", str(payload.get("timeout_seconds", 60))])
        try:
            completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True,
                                       timeout=int(payload.get("timeout_seconds", 60)) + 5, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return envelope("blocked", limitations=[f"Provider invocation failed: {type(exc).__name__}."])
        if completed.returncode != 0:
            try:
                error = json.loads(completed.stderr or completed.stdout).get("error")
            except (json.JSONDecodeError, AttributeError):
                error = None
            return envelope("blocked", evidence=["team/provider_router.py"],
                            limitations=[error or "Provider call did not complete."])
        try:
            result = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return envelope("blocked", limitations=["Provider router returned invalid JSON."])
        return envelope("ready", result, ["team/provider_router.py"],
                        ["This invocation made an external or local model request; provider billing and availability depend on the selected route."])

    if tool_id == "team.agent.resolve":
        agent_id = payload.get("agent_id")
        if not agent_id:
            task = payload.get("task")
            capabilities = payload.get("capabilities", [])
            if not isinstance(task, str) or not task.strip() or not isinstance(capabilities, list) or not capabilities:
                return envelope("blocked", limitations=["Provide agent_id or a task with explicit capabilities."])
            routed = subprocess.run(
                [sys.executable, str(ROUTER)],
                input=json.dumps({"task": task, "capabilities": capabilities, "context": payload.get("context", {})}),
                capture_output=True, text=True, cwd=ROOT, check=False,
            )
            try:
                dispatch = json.loads(routed.stdout).get("dispatch")
            except json.JSONDecodeError:
                dispatch = None
            if not dispatch:
                return envelope("blocked", result=routed.stdout,
                                limitations=[routed.stderr.strip() or "No specialist dispatch was produced."])
            agent_id = dispatch.get("agent_id")
        agent = next((item for item in manifest.get("agents", []) if item.get("id") == agent_id), None)
        if agent is None:
            return envelope("blocked", limitations=[f"Unknown agent ID: {agent_id}"])
        prompt_path = ROOT / "team" / "agents" / f"{agent_id}.md"
        if not prompt_path.is_file():
            return envelope(
                "blocked", evidence=[f"team/manifest.json#agents/{agent_id}"],
                limitations=[f"No verified prompt file exists for {agent_id}; source/identity may be unresolved."],
            )
        return envelope(
            "ready",
            {"agent_id": agent_id, "role": agent.get("role"), "declared_status": agent.get("status"),
             "prompt": prompt_path.read_text(encoding="utf-8"), "requires": agent.get("requires", [])},
            [str(prompt_path.relative_to(ROOT))],
            ["Prompt resolution does not execute an LLM agent or connect required external runtimes."]
        )

    if tool_id == "team.queue":
        operation = payload.get("action", payload.get("operation"))
        if operation not in {"enqueue", "claim", "complete", "fail", "list"}:
            return envelope("blocked", limitations=["Queue operation must be enqueue, claim, complete, fail, or list."])
        db_path = str(payload.get("db", ROOT / "team" / "queue.sqlite3"))
        command = [sys.executable, str(ROOT / "team" / "queue.py"), "--db", db_path, operation]
        if operation == "enqueue":
            task = payload.get("task")
            data = payload.get("payload", {})
            if not isinstance(task, str) or not task.strip() or not isinstance(data, dict):
                return envelope("blocked", limitations=["enqueue requires a non-empty task and object payload."])
            command.extend(["--task", task, "--payload", json.dumps(data)])
            if "max_attempts" in payload:
                command.extend(["--max-attempts", str(payload["max_attempts"])])
        elif operation == "claim":
            worker = payload.get("worker", payload.get("worker_id"))
            if not isinstance(worker, str) or not worker.strip():
                return envelope("blocked", limitations=["claim requires worker_id."])
            command.extend(["--worker", worker])
            if "lease_seconds" in payload:
                command.extend(["--lease-seconds", str(payload["lease_seconds"])])
        elif operation in {"complete", "fail"}:
            job_id, worker = payload.get("id", payload.get("job_id")), payload.get("worker", payload.get("worker_id"))
            if not all(isinstance(value, str) and value.strip() for value in (job_id, worker)):
                return envelope("blocked", limitations=[f"{operation} requires job_id and worker_id."])
            claim_token = payload.get("claim_token")
            if not isinstance(claim_token, str) or not claim_token:
                return envelope("blocked", limitations=[f"{operation} requires claim_token."])
            command.extend(["--id", job_id, "--worker", worker, "--claim-token", claim_token])
            if operation == "complete":
                result_data = payload.get("result", {})
                if not isinstance(result_data, dict):
                    return envelope("blocked", limitations=["complete result must be a JSON object."])
                command.extend(["--result", json.dumps(result_data)])
            else:
                error = payload.get("error")
                if not isinstance(error, str) or not error.strip():
                    return envelope("blocked", limitations=["fail requires a non-empty error string."])
                command.extend(["--error", error])
        else:
            if payload.get("status"):
                command.extend(["--status", str(payload["status"])])
            command.extend(["--limit", str(payload.get("limit", 100))])
        try:
            completed = subprocess.run(
                command, cwd=ROOT, capture_output=True, text=True,
                timeout=int(payload.get("timeout_seconds", 30)), check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return envelope("blocked", limitations=[f"Queue invocation failed: {exc}"])
        try:
            response = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return envelope("blocked", result=completed.stdout,
                            evidence=["team/queue.py"],
                            limitations=[completed.stderr.strip() or "Queue returned non-JSON output."])
        if completed.returncode or response.get("status") != "ready":
            return envelope("blocked", result=response.get("result"),
                            evidence=["team/queue.py"],
                            limitations=[response.get("error") or completed.stderr.strip() or "Queue operation failed."])
        return envelope("ready", response.get("result"), ["team/queue.py"],
                        ["Queue is persistent, but queued jobs are not executed by this interface."])

    if tool_id == "team.worker":
        worker_id = payload.get("worker_id")
        if not isinstance(worker_id, str) or not worker_id.strip():
            return envelope("blocked", limitations=["team.worker requires a non-empty worker_id."])
        command = [sys.executable, str(ROOT / "team" / "worker.py"),
                   "--worker-id", worker_id, "--once"]
        if payload.get("db"):
            command.extend(["--db", str(payload["db"])])
        if "lease_seconds" in payload:
            command.extend(["--lease-seconds", str(payload["lease_seconds"])])
        try:
            completed = subprocess.run(
                command, cwd=ROOT, capture_output=True, text=True,
                timeout=int(payload.get("timeout_seconds", 150)), check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return envelope("blocked", limitations=[f"Worker invocation failed: {exc}"])
        try:
            report = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return envelope("blocked", result=completed.stdout,
                            evidence=["team/worker.py"],
                            limitations=[completed.stderr.strip() or "Worker returned invalid JSON."])
        if completed.returncode or report.get("status") == "blocked":
            return envelope("blocked", result=report,
                            evidence=["team/worker.py"],
                            limitations=[report.get("error") or completed.stderr.strip() or "Worker failed."])
        return envelope("ready", report, ["team/worker.py"],
                        ["One queued job was handled at most; worker executes only its explicit allowlist."])

    if tool_id == "knowledge.search":
        query = payload.get("query")
        if not isinstance(query, str) or not query.strip():
            return envelope("blocked", limitations=["knowledge.search requires a non-empty query."])
        command = [
            sys.executable, str(ROOT / "tools" / "knowledge" / "knowledge_search.py"),
            payload.get("path", "."), "--query", query,
            "--top-k", str(payload.get("top_k", 5)), "--json",
        ]
        try:
            completed = subprocess.run(
                command, cwd=ROOT, capture_output=True, text=True,
                timeout=int(payload.get("timeout_seconds", 60)), check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return envelope("blocked", limitations=[f"Knowledge search invocation failed: {exc}"])
        if completed.returncode:
            return envelope("blocked", result=completed.stdout.strip() or None,
                            evidence=["tools/knowledge/knowledge_search.py"],
                            limitations=[completed.stderr.strip() or "Knowledge search failed."])
        try:
            report = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return envelope("blocked", result=completed.stdout,
                            evidence=["tools/knowledge/knowledge_search.py"],
                            limitations=["Knowledge search returned non-JSON output."])
        return envelope("ready", report, ["tools/knowledge/knowledge_search.py"],
                        report.get("limitations", []))


    if tool_id == "mcp.remote":
        action = payload.get("action")
        server_name = payload.get("server")
        if action not in {"list", "call"} or not isinstance(server_name, str) or not server_name.strip():
            return envelope("blocked", limitations=["mcp.remote requires action=list|call and a configured server name."])
        remote_script = ROOT / "team" / "remote_mcp.py"
        command = [sys.executable, str(remote_script), action, "--server", server_name,
                   "--timeout", str(payload.get("timeout_seconds", 30))]
        if action == "call":
            tool_name, arguments = payload.get("tool"), payload.get("arguments", {})
            if not isinstance(tool_name, str) or not tool_name.strip() or not isinstance(arguments, dict):
                return envelope("blocked", limitations=["mcp.remote call requires a tool name and object arguments."])
            command.extend(["--tool", tool_name, "--arguments", json.dumps(arguments)])
        try:
            completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True,
                                       timeout=int(payload.get("timeout_seconds", 30)) + 5, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return envelope("blocked", limitations=[f"Remote MCP invocation failed: {type(exc).__name__}."])
        try:
            report = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return envelope("blocked", result=completed.stdout,
                            evidence=["team/remote_mcp.py"],
                            limitations=[completed.stderr.strip() or "Remote MCP returned invalid JSON."])
        if completed.returncode or report.get("status") != "ready":
            return envelope("blocked", result=report.get("result"),
                            evidence=["team/remote_mcp.py"],
                            limitations=[report.get("error") or completed.stderr.strip() or "Remote MCP call failed."])
        return envelope("ready", report.get("result"), ["team/remote_mcp.py", "team/remote_mcp.json"],
                        ["Remote endpoints must be explicitly enabled with HTTPS and tool allowlists. Credentials are read from environment variables."])

    adapters = {
        "rea.scan": (ROOT / "tools" / "rea" / "rea.py", "source"),
        "security.scan": (ROOT / "tools" / "security_review" / "security_review.py", "source"),
        "team.health": (ROOT / "team" / "health.py", "health"),
    }
    adapter = adapters.get(tool_id)
    if adapter is None or not adapter[0].is_file():
        return envelope(
            "not_implemented", evidence=[f"team/manifest.json#tools/{tool_id}"],
            limitations=["No verified executable adapter exists for this declaration."],
        )
    script, mode = adapter
    command = [sys.executable, str(script)]
    if mode == "source":
        command.extend([payload.get("path", "."), "--json"])
        if payload.get("out"):
            command.extend(["--out", str(payload["out"])])
    else:
        command.append("--json")
    try:
        completed = subprocess.run(
            command, cwd=ROOT, capture_output=True, text=True,
            timeout=int(payload.get("timeout_seconds", 120)), check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return envelope("blocked", limitations=[f"Invocation failed: {exc}"])
    if completed.returncode:
        return envelope(
            "blocked", result=completed.stdout.strip() or None,
            evidence=[str(script.relative_to(ROOT))],
            limitations=[completed.stderr.strip() or f"Tool exited {completed.returncode}"],
        )
    try:
        report = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return envelope(
            "blocked", result=completed.stdout,
            evidence=[str(script.relative_to(ROOT))],
            limitations=["Tool output was not valid JSON."],
        )
    limitations = report.get("limitations", []) if isinstance(report, dict) else []
    return envelope("ready", report, [str(script.relative_to(ROOT))], limitations)


def run(payload, manifest):
    operation = payload.get("operation", "route")
    if operation == "list-tools":
        return list_tools(manifest)
    if operation == "invoke":
        tool_id = payload.get("tool_id")
        if not isinstance(tool_id, str) or not tool_id.strip():
            return envelope("blocked", limitations=["tool_id is required for invoke."])
        input_data = payload.get("input", {})
        if not isinstance(input_data, dict):
            return envelope("blocked", limitations=["input must be a JSON object."])
        return invoke(tool_id, input_data, manifest)
    if operation != "route":
        return envelope("blocked", limitations=[f"Unsupported operation: {operation}"])
    completed = subprocess.run(
        [sys.executable, str(ROUTER)],
        input=json.dumps(payload), capture_output=True, text=True,
        cwd=ROOT, check=False,
    )
    if completed.returncode:
        return envelope("blocked", result=completed.stdout.strip() or None,
                        limitations=[completed.stderr.strip() or "Router failed."])
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError:
        return envelope("blocked", result=completed.stdout,
                        limitations=["Router returned non-JSON output."])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", help="JSON task; otherwise read JSON from stdin.")
    args = parser.parse_args()
    try:
        payload = json.loads(args.task) if args.task else json.loads(sys.stdin.read())
        if not isinstance(payload, dict):
            raise ValueError("Input must be a JSON object.")
        print(json.dumps(run(payload, load_manifest()), indent=2))
    except Exception as exc:
        print(json.dumps(envelope("blocked", limitations=[str(exc)]), indent=2))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
