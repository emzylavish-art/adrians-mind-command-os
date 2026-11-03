import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "security_review.py"
spec = importlib.util.spec_from_file_location("security_review", SCRIPT)
security_review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(security_review)


class SecurityReviewTests(unittest.TestCase):
    def test_finds_heuristics_and_redacts_secret(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "sample.py").write_text(
                'password = "supersecret-value-123"\n'
                'subprocess.run(cmd, shell=True)\n'
                'eval(user_input)\n',
                encoding="utf-8",
            )
            report = security_review.review(root)
            self.assertGreaterEqual(report["findings_count"], 3)
            self.assertNotIn("supersecret-value-123", str(report["findings"]))
            self.assertIn("[REDACTED]", str(report["findings"]))

    def test_skips_generated_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            generated = root / "node_modules"
            generated.mkdir()
            (generated / "app.js").write_text("eval(x)", encoding="utf-8")
            report = security_review.review(root)
            self.assertEqual(report["files_scanned"], 0)
            self.assertEqual(report["findings_count"], 0)

    def test_missing_path_is_rejected(self):
        with self.assertRaises(ValueError):
            security_review.review(Path("/path/that/should/not/exist/mind-command-os"))


if __name__ == "__main__":
    unittest.main()
