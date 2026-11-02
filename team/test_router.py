import importlib.util, json, unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("router",HERE/"router.py")
router=importlib.util.module_from_spec(spec); spec.loader.exec_module(router)
class RouterTests(unittest.TestCase):
    def test_rea_capability_routes_to_rea(self):
        out=router.route({"task":"inventory this repo","capabilities":["source_inventory"]},router.load())
        self.assertEqual(out["dispatch"]["agent_id"],"rea")
        self.assertEqual(out["status"],"ready")
    def test_unmatched_capability_blocks(self):
        out=router.route({"task":"x","capabilities":["unlisted_ability"]},router.load())
        self.assertEqual(out["status"],"blocked")
if __name__=="__main__": unittest.main()
