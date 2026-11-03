import http.server
import importlib.util
import json
import threading
import unittest
from pathlib import Path

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("zap_passive", HERE / "zap_passive.py")
zap_passive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(zap_passive)


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        body = b"<html><body><img src=\"http://example.com/x.png\"></body></html>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        # Intentionally omit security headers
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return


class ZapPassiveTests(unittest.TestCase):
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

    def test_passive_probe_reports_missing_headers(self):
        report = zap_passive.scan(self.base)
        self.assertEqual(report["mode"], "passive-only")
        self.assertEqual(report["scan"]["engine"], "in-repo-passive-probe")
        ids = {f["id"] for f in report["scan"]["findings"]}
        self.assertIn("missing_content_security_policy", ids)
        json.dumps(report)

    def test_rejects_foreign_host(self):
        with self.assertRaises(ValueError):
            zap_passive.scan("https://example.com/")


if __name__ == "__main__":
    unittest.main()
