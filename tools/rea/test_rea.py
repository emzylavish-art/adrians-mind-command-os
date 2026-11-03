import importlib.util
import tempfile
import unittest
from pathlib import Path

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location("rea",HERE/"rea.py")
rea=importlib.util.module_from_spec(spec)
spec.loader.exec_module(rea)

class ReaTests(unittest.TestCase):
    def test_inventory_and_manifest_detection(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            (root/"package.json").write_text('{"name":"fixture"}')
            (root/"main.py").write_text('print("hello")\n# TODO: inspect\n')
            report=rea.scan(root)
            self.assertEqual(report["file_count"],2)
            self.assertIn("package.json",report["manifests"])
            self.assertIn("main.py",report["likely_entrypoints"])
            self.assertTrue(any(x["kind"]=="TODO" for x in report["markers"]))

    def test_skips_dependency_directories(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            (root/"node_modules").mkdir()
            (root/"node_modules"/"hidden.js").write_text("x")
            (root/"visible.py").write_text("x")
            self.assertEqual(rea.scan(root)["file_count"],1)

if __name__=="__main__": unittest.main()
