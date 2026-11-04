import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "website" / "passes.py"


def run(ledger, *args):
    completed = subprocess.run(
        [sys.executable, str(TOOL), *args, "--ledger", ledger, "--json"],
        capture_output=True, text=True, cwd=ROOT, check=False,
    )
    if completed.returncode:
        raise AssertionError(completed.stdout + completed.stderr)
    return json.loads(completed.stdout)


class WebsitePassTests(unittest.TestCase):
    def test_first_pass_requires_every_website_tool(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = str(Path(directory) / "ledger.json")
            report = run(ledger, "plan", "--surface", "Login screen")
            self.assertEqual(report["pass"], "first")
            self.assertEqual(len(report["use"]), 11)
            self.assertEqual(report["skip"], [])
            self.assertIn("gods-eye-view", [item["id"] for item in report["use"]])
            self.assertNotIn("21st", [item["id"] for item in report["use"]])

    def test_satisfied_tool_is_skipped_and_the_rest_stay(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = str(Path(directory) / "ledger.json")
            run(ledger, "record", "--surface", "login", "--tool", "gsap", "--evidence", "Added the composer timeline.")
            run(ledger, "satisfy", "--surface", "login", "--tool", "gsap")
            report = run(ledger, "plan", "--surface", "login")
            self.assertEqual(report["pass"], "follow-up")
            self.assertEqual([item["id"] for item in report["skip"]], ["gsap"])
            self.assertNotIn("gsap", [item["id"] for item in report["use"]])
            self.assertEqual(len(report["use"]), 10)

    def test_other_surface_still_requires_the_satisfied_tool(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = str(Path(directory) / "ledger.json")
            run(ledger, "record", "--surface", "login", "--tool", "gsap", "--evidence", "Composer only.")
            run(ledger, "satisfy", "--surface", "login", "--tool", "gsap")
            report = run(ledger, "plan", "--surface", "memory")
            self.assertIn("gsap", [item["id"] for item in report["use"]])

    def test_cannot_satisfy_before_use(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = str(Path(directory) / "ledger.json")
            completed = subprocess.run(
                [sys.executable, str(TOOL), "satisfy", "--surface", "login", "--tool", "taste", "--ledger", ledger],
                capture_output=True, text=True, cwd=ROOT, check=False,
            )
            self.assertNotEqual(completed.returncode, 0)


if __name__ == "__main__":
    unittest.main()
