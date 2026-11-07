import importlib.util
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("router", HERE / "router.py")
router = importlib.util.module_from_spec(spec)
spec.loader.exec_module(router)


class RouterTests(unittest.TestCase):
    def test_rea_capability_routes_to_ready_rea(self):
        out = router.route({"task": "inventory this repo", "capabilities": ["source_inventory"]}, router.load())
        self.assertEqual(out["dispatch"]["agent_id"], "rea")
        self.assertEqual(out["status"], "ready")

    def test_security_capability_routes_with_partial_disclosure(self):
        out = router.route(
            {"task": "review owned source", "capabilities": ["secure_code_review"]},
            router.load(),
        )
        self.assertEqual(out["dispatch"]["agent_id"], "security")
        self.assertEqual(out["status"], "partial")
        self.assertTrue(out["limitations"])

    def test_unmatched_capability_blocks(self):
        out = router.route({"task": "x", "capabilities": ["unlisted_ability"]}, router.load())
        self.assertEqual(out["status"], "blocked")

    def test_no_capability_blocks_instead_of_guessing(self):
        out = router.route({"task": "write a web app"}, router.load())
        self.assertEqual(out["status"], "blocked")
        self.assertIsNone(out["dispatch"])

    def test_tie_break_is_stable(self):
        manifest = {"agents": [
            {"id": "z-agent", "role": "Z", "capabilities": ["shared"], "status": "ready"},
            {"id": "a-agent", "role": "A", "capabilities": ["shared"], "status": "ready"},
        ]}
        out = router.route({"task": "choose", "capabilities": ["shared"]}, manifest)
        self.assertEqual(out["dispatch"]["agent_id"], "a-agent")

    def test_partial_specialist_is_disclosed(self):
        manifest = {"agents": [
            {"id": "partial", "role": "Partial", "capabilities": ["shared"], "status": "partial",
             "requires": ["runtime"]},
        ]}
        out = router.route({"task": "choose", "capabilities": ["shared"]}, manifest)
        self.assertEqual(out["status"], "partial")
        self.assertTrue(out["limitations"])


if __name__ == "__main__":
    unittest.main()
