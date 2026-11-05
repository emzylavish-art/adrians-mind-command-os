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

    def test_voice_and_connection_fleet_agents_are_known(self):
        manifest = json.loads((ROOT / "team" / "manifest.json").read_text(encoding="utf-8"))
        ids = {agent.get("id") for agent in manifest.get("agents", [])}
        for agent_id in ("voice-stream", "latency-guard", "connection-sentinel", "integration-verifier"):
            self.assertIn(agent_id, ids)
            self.assertTrue((ROOT / "team" / "agents" / f"{agent_id}.md").is_file(), agent_id)


if __name__ == "__main__":
    unittest.main()
