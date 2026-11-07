import importlib.util
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("health", HERE / "health.py")
health_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health_module)


class HealthTests(unittest.TestCase):
    def test_report_is_ok_and_ready_entrypoints_exist(self):
        report = health_module.health()
        self.assertEqual(report["status"], "ok")
        ready = [tool for tool in report["tools"] if tool["declared_status"] == "ready"]
        self.assertTrue(ready)
        self.assertTrue(all(tool["entrypoint_exists"] for tool in ready))

    def test_entrypoint_command_prefix_is_parsed(self):
        path = health_module.entrypoint_path("python3 tools/rea/rea.py")
        self.assertEqual(path, health_module.ROOT / "tools/rea/rea.py")
        self.assertTrue(path.exists())


if __name__ == "__main__":
    unittest.main()
