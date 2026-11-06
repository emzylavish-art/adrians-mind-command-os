import http.client
import json
import sys
import threading
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "team"))
import mcp_http  # noqa: E402
import runner  # noqa: E402


class MCPHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.token = "unit-test-token"
        cls.server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            mcp_http.make_handler(cls.token, runner.load_manifest()),
        )
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        payload = None if body is None else json.dumps(body)
        conn.request(method, path, body=payload, headers=headers or {})
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        parsed = json.loads(raw) if raw else None
        return response.status, parsed

    def test_health_endpoint(self):
        status, body = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"status": "ok"})

    def test_requires_bearer_token(self):
        status, body = self.request("POST", "/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                                    {"Content-Type": "application/json"})
        self.assertEqual(status, 401)
        self.assertEqual(body["error"], "Unauthorized.")

    def test_authenticated_tools_list(self):
        status, body = self.request(
            "POST", "/mcp",
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            {"Content-Type": "application/json", "Authorization": f"Bearer {self.token}"},
        )
        self.assertEqual(status, 200)
        names = [tool["name"] for tool in body["result"]["tools"]]
        self.assertIn("rea.scan", names)
        self.assertIn("team.worker", names)
        self.assertIn("team.agent.resolve", names)
        self.assertIn("model.generate", names)
        self.assertIn("notion.controller", names)

    def test_notification_returns_accepted(self):
        status, body = self.request(
            "POST", "/mcp",
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"Content-Type": "application/json", "Authorization": f"Bearer {self.token}"},
        )
        self.assertEqual(status, 202)
        self.assertIsNone(body)

    def test_wrong_path_is_not_found(self):
        status, body = self.request(
            "POST", "/wrong",
            {"jsonrpc": "2.0", "id": 3, "method": "ping"},
            {"Content-Type": "application/json", "Authorization": f"Bearer {self.token}"},
        )
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
