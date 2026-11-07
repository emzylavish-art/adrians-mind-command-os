import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "team" / "mcp_server.py"


def rpc(messages):
    proc = subprocess.run(
        [sys.executable, str(SERVER)],
        input="\n".join(json.dumps(item) for item in messages) + "\n",
        capture_output=True,
        text=True,
        cwd=ROOT,
        check=False,
    )
    if proc.returncode:
        raise AssertionError(proc.stderr)
    return [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]


class MCPServerTests(unittest.TestCase):
    def test_initialize_and_list_ready_tools(self):
        responses = rpc([
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        ])
        self.assertEqual(responses[0]["result"]["serverInfo"]["name"], "mind-command-os-tools")
        self.assertIn("rea.scan", [tool["name"] for tool in responses[1]["result"]["tools"]])
        self.assertIn("security.scan", [tool["name"] for tool in responses[1]["result"]["tools"]])
        self.assertIn("team.health", [tool["name"] for tool in responses[1]["result"]["tools"]])
        self.assertIn("model.generate", [tool["name"] for tool in responses[1]["result"]["tools"]])
        self.assertIn("notion.controller", [tool["name"] for tool in responses[1]["result"]["tools"]])
        self.assertIn("team.queue", [tool["name"] for tool in responses[1]["result"]["tools"]])
        self.assertIn("knowledge.search", [tool["name"] for tool in responses[1]["result"]["tools"]])
        self.assertIn("team.worker", [tool["name"] for tool in responses[1]["result"]["tools"]])
        names = [tool["name"] for tool in responses[1]["result"]["tools"]]
        self.assertIn("model.generate", names)
        self.assertIn("notion.controller", names)
        schemas = {tool["name"]: tool["inputSchema"] for tool in responses[1]["result"]["tools"]}
        self.assertEqual(schemas["model.generate"]["properties"]["provider"]["enum"], ["openai", "grok", "openrouter", "ollama"])
        self.assertEqual(schemas["notion.controller"]["properties"]["action"]["enum"],
                         ["search", "retrieve-page", "retrieve-children", "append-text"])
        self.assertIn("team.queue", names)
        self.assertIn("team.health", [tool["name"] for tool in responses[1]["result"]["tools"]])

    def test_call_rea_scan(self):
        responses = rpc([{
            "jsonrpc": "2.0", "id": 7, "method": "tools/call",
            "params": {"name": "rea.scan", "arguments": {"path": "team"}},
        }])
        result = json.loads(responses[0]["result"]["content"][0]["text"])
        self.assertEqual(result["status"], "ready")

    def test_call_security_scan(self):
        responses = rpc([{
            "jsonrpc": "2.0", "id": 9, "method": "tools/call",
            "params": {"name": "security.scan", "arguments": {"path": "team"}},
        }])
        result = json.loads(responses[0]["result"]["content"][0]["text"])
        self.assertEqual(result["status"], "ready")
        self.assertIn("tools/security_review/security_review.py", result["evidence"])

    def test_call_team_health(self):
        responses = rpc([{
            "jsonrpc": "2.0", "id": 10, "method": "tools/call",
            "params": {"name": "team.health", "arguments": {}},
        }])
        result = json.loads(responses[0]["result"]["content"][0]["text"])
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["result"]["status"], "ok")

    def test_call_queue_enqueue(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            db = str(Path(tmp) / "queue.sqlite3")
            responses = rpc([{
                "jsonrpc": "2.0", "id": 11, "method": "tools/call",
                "params": {"name": "team.queue", "arguments": {
                    "action": "enqueue", "task": "MCP queued job", "payload": {"a": 1}, "db": db
                }},
            }])
            result = json.loads(responses[0]["result"]["content"][0]["text"])
            self.assertEqual(result["status"], "ready", result)
            self.assertEqual(result["result"]["status"], "queued")
            self.assertNotIn("claim_token", result["result"])

    def test_call_knowledge_search(self):
        responses = rpc([{
            "jsonrpc": "2.0", "id": 11, "method": "tools/call",
            "params": {"name": "knowledge.search", "arguments": {
                "path": "team", "query": "manifest agent tools", "top_k": 3,
            }},
        }])
        result = json.loads(responses[0]["result"]["content"][0]["text"])
        self.assertEqual(result["status"], "ready")
        self.assertIsInstance(result["result"]["results"], list)

    def test_queue_enqueue_via_mcp(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = str(Path(tmp) / "queue.sqlite3")
            responses = rpc([{
                "jsonrpc": "2.0", "id": 12, "method": "tools/call",
                "params": {"name": "team.queue", "arguments": {
                    "operation": "enqueue", "db": db, "task": "MCP queue test",
                    "payload": {"intent": "verify"},
                }},
            }])
            result = json.loads(responses[0]["result"]["content"][0]["text"])
            self.assertEqual(result["status"], "ready")
            self.assertEqual(result["result"]["status"], "queued")

    def test_call_allowlisted_worker(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = str(Path(tmp) / "queue.sqlite3")
            rpc([{
                "jsonrpc": "2.0", "id": 20, "method": "tools/call",
                "params": {"name": "team.queue", "arguments": {
                    "operation": "enqueue", "db": db, "task": "health job",
                    "payload": {"tool_id": "team.health", "input": {}},
                }},
            }])
            responses = rpc([{
                "jsonrpc": "2.0", "id": 21, "method": "tools/call",
                "params": {"name": "team.worker", "arguments": {
                    "worker_id": "mcp-worker", "db": db,
                }},
            }])
            result = json.loads(responses[0]["result"]["content"][0]["text"])
            self.assertEqual(result["status"], "ready", result)
            self.assertEqual(result["result"]["status"], "succeeded")

    def test_agent_prompt_resolver_via_mcp(self):
        responses = rpc([{
            "jsonrpc": "2.0", "id": 13, "method": "tools/call",
            "params": {"name": "team.agent.resolve", "arguments": {"agent_id": "orchestrator"}},
        }])
        result = json.loads(responses[0]["result"]["content"][0]["text"])
        self.assertEqual(result["status"], "ready")
        self.assertIn("Orchestrator", result["result"]["prompt"])

    def test_unavailable_tool_is_error_not_simulated(self):
        responses = rpc([{
            "jsonrpc": "2.0", "id": 8, "method": "tools/call",
            "params": {"name": "gods-eyes", "arguments": {}},
        }])
        self.assertTrue(responses[0]["result"]["isError"])

    def test_invalid_jsonrpc_is_protocol_error(self):
        responses = rpc([{"jsonrpc": "1.0", "id": 99, "method": "ping"}])
        self.assertEqual(responses[0]["error"]["code"], -32600)


if __name__ == "__main__":
    unittest.main()
