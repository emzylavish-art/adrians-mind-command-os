import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "knowledge_search.py"
spec = importlib.util.spec_from_file_location("knowledge_search", SCRIPT)
knowledge_search = importlib.util.module_from_spec(spec)
spec.loader.exec_module(knowledge_search)


class KnowledgeSearchTests(unittest.TestCase):
    def test_search_returns_relevant_local_markdown(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "architecture.md").write_text(
                "# Agent architecture\nThe orchestrator dispatches specialist agents and tools.\n",
                encoding="utf-8",
            )
            (root / "notes.txt").write_text(
                "Content about a garden and planting vegetables.\n",
                encoding="utf-8",
            )
            result = knowledge_search.search(root, "orchestrator specialist tools")
            self.assertEqual(len(result["results"]), 1)
            self.assertEqual(result["results"][0]["file"], "architecture.md")
            self.assertIn("orchestrator", result["results"][0]["matched_terms"])

    def test_empty_query_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                knowledge_search.search(Path(tmp), "!!!")

    def test_top_k_range_enforced(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                knowledge_search.search(Path(tmp), "notes", 0)


if __name__ == "__main__":
    unittest.main()
