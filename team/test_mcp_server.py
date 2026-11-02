import json
import subprocess
import sys
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
        self.assertIn("rea.scan", [tool["name"] for tool in responses[1]["result"]["tools"]])\n        self.assertIn("security.scan", [tool["name"] for tool in responses[1]["result"]["tools"]])

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

    def test_unavailable_tool_is_error_not_simulated(self):
        responses = rpc([{
            "jsonrpc": "2.0", "id": 8, "method": "tools/call",
            "params": {"name": "gods-eyes", "arguments": {}},
        }])
        self.assertTrue(responses[0]["result"]["isError"])


if __name__ == "__main__":
    unittest.main()
