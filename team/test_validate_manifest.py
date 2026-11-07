import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "team" / "validate_manifest.py"


class ManifestValidatorTests(unittest.TestCase):
    def test_current_manifest_and_registry_validate(self):
        proc = subprocess.run([sys.executable, str(VALIDATOR)], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        result = json.loads(proc.stdout)
        self.assertEqual(result["status"], "ready")
        self.assertTrue(any("agents" in item for item in result["result"]))


if __name__ == "__main__":
    unittest.main()
