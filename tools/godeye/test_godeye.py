import http.server
import importlib.util
import json
import threading
import unittest
from pathlib import Path

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("godeye", HERE / "godeye.py")
godeye = importlib.util.module_from_spec(spec)
spec.loader.exec_module(godeye)

FIXTURE = """<!doctype html><html><head><title>GodEye Fixture</title>
<link rel="stylesheet" href="/a.css">
<script src="/a.js"></script></head>
<body>
<a href="/ok">ok</a>
<a href="/missing">missing</a>
<button type="button" id="b1">Go</button>
<form method="get" action="/search"><input name="q" type="text"></form>
</body></html>"""


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path in {"/", "/index.html"}:
            body = FIXTURE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/ok":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_response(404)
            self.end_headers()

    def do_HEAD(self):  # noqa: N802
        self.do_GET()

    def do_POST(self):  # noqa: N802
        self.send_response(405)
        self.end_headers()

    def log_message(self, *_args):
        return


class GodEyeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.port}/"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def test_requests_audit_finds_structure_and_broken_link(self):
        report = godeye.audit(self.base, prefer_playwright=False)
        self.assertEqual(report["page"]["engine"], "requests")
        self.assertEqual(report["page"]["status"], 200)
        self.assertEqual(report["page"]["title"], "GodEye Fixture")
        self.assertGreaterEqual(len(report["page"]["links"]), 2)
        self.assertGreaterEqual(len(report["page"]["buttons"]), 1)
        self.assertGreaterEqual(len(report["page"]["forms"]), 1)
        self.assertTrue(any(x["status"] == 404 for x in report["same_origin_link_statuses"]))
        json.dumps(report)  # serializable

    def test_rejects_non_allowlisted_host(self):
        with self.assertRaises(ValueError):
            godeye.audit("https://example.com/")


if __name__ == "__main__":
    unittest.main()
