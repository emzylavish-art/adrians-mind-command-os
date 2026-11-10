import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


orchestrator = load("orchestrator")
manus = load("manus_adapter")
automations = load("automations")
control = load("control")
worker = load("worker")


class OrchestrationTests(unittest.TestCase):
    def test_phase0_inventory_marks_cloud_blocked(self):
        report = orchestrator.inventory()
        self.assertEqual(report["status"], "ready")
        self.assertEqual(report["result"]["manus_cloud"], "blocked")
        checked = {row["id"]: row["checked"] for row in report["result"]["tools"]}
        self.assertEqual(checked["team.queue"], "ready")
        self.assertEqual(checked["team.manus"], "ready")
        self.assertIn("queue", report["result"]["will_not_rebuild"])

    def test_phase1_reason_does_not_call_gpt_and_writes_log(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = orchestrator.run({
                "action": "reason", "task": "Summarize the locked split.", "state_dir": tmp,
            })
            self.assertEqual(report["status"], "partial")
            self.assertEqual(report["result"]["lane"], "local")
            self.assertTrue(any("GPT was not invoked" in item for item in report["limitations"]))
            self.assertIn("GROK-BUILD", control.read_log(tmp)[0])
            routed = orchestrator.run({
                "action": "route_and_enqueue",
                "task": "Write the plan schema only.",
                "capabilities": ["planning"],
                "state_dir": tmp,
                "db": str(Path(tmp) / "q.sqlite3"),
                "tier": 0,
            })
            self.assertIsNone(routed["result"]["enqueued"])

    def test_phase2_and_3_one_step_then_resume_on_a_new_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = str(Path(tmp) / "q.sqlite3")
            control.save_project(tmp, "proof", {"project_id": "proof", "instructions": "Inherit this.", "files": []})
            first = orchestrator.run({
                "action": "route_and_enqueue",
                "task": "Produce the research artifact.",
                "capabilities": ["execution_computer"],
                "state_dir": tmp,
                "db": db,
                "project_id": "proof",
                "tier": 0,
            })
            self.assertEqual(first["status"], "ready")
            self.assertTrue(first["result"]["why"]["dispatch"]["agent_id"])
            outcome = worker.process_one(db, "worker-a", 120)
            self.assertEqual(outcome["status"], "succeeded")
            body = outcome["result"]
            self.assertEqual(body["status"], "partial")
            self.assertEqual(body["result"]["cursor"], 1)
            self.assertFalse(body["result"]["resumed"])
            worker.queue_call(db, "enqueue", [
                "--task", "resume research artifact",
                "--payload", json.dumps({
                    "tool_id": "team.manus",
                    "input": {
                        "goal": "Produce the research artifact.",
                        "transport": "local",
                        "state_dir": tmp,
                        "project_id": "proof",
                        "tier": 0,
                    },
                }),
            ])
            again = worker.process_one(db, "worker-b", 120)
            self.assertEqual(again["status"], "succeeded")
            resumed = again["result"]
            self.assertTrue(resumed["result"]["resumed"])
            self.assertEqual(resumed["result"]["cursor"], 2)
            evidence = Path(tmp) / "computers" / "proof" / "evidence.md"
            self.assertIn("Inherit this.", evidence.read_text(encoding="utf-8"))
            self.assertTrue(control.read_timeline(tmp))

    def test_phase4_trigger_uses_the_existing_queue_and_obeys_kill_switch(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = str(Path(tmp) / "q.sqlite3")
            blocked = automations.accept({
                "state_dir": tmp, "db": db,
                "trigger": {"type": "time", "name": "daily-research-summary"},
                "spent": 10, "limit": 10,
            })
            self.assertEqual(blocked["status"], "blocked")
            control.set_kill(tmp, True)
            stopped = automations.accept({
                "state_dir": tmp, "db": db,
                "trigger": {"type": "time", "name": "daily-research-summary"},
            })
            self.assertIn("Kill switch", stopped["limitations"][0])
            control.set_kill(tmp, False)
            accepted = automations.accept({
                "state_dir": tmp, "db": db,
                "trigger": {"type": "time", "name": "daily-research-summary"},
            })
            self.assertEqual(accepted["status"], "ready")
            self.assertTrue(accepted["result"]["enqueued"])

    def test_phase5_tier3_needs_approval_and_kill_survives_a_new_call(self):
        with tempfile.TemporaryDirectory() as tmp:
            denied = manus.run_local({
                "goal": "Publish the report.", "transport": "local",
                "state_dir": tmp, "project_id": "gated", "tier": 3,
            })
            self.assertEqual(denied["status"], "blocked")
            allowed = manus.run_local({
                "goal": "Publish the report.", "transport": "local",
                "state_dir": tmp, "project_id": "gated", "tier": 3,
                "approval": {"approved": True, "id": "human-1"},
            })
            self.assertEqual(allowed["status"], "partial")
            self.assertIn("Manus Cloud was not called.", allowed["limitations"][0])
            missing = orchestrator.run({
                "action": "synthesize", "state_dir": tmp, "tier": 0, "evidence": {"summary": "x"},
            })
            self.assertEqual(missing["status"], "blocked")
            accepted = orchestrator.run({
                "action": "synthesize", "state_dir": tmp, "tier": 3,
                "approval": {"approved": True, "id": "human-1"},
                "evidence": {
                    "summary": "done", "artifact_files": ["report.md"], "evidence_log": ["report.md"],
                },
            })
            self.assertEqual(accepted["status"], "ready")
            self.assertFalse(accepted["result"]["notion_writeback"]["sent"])
            deferred = accepted["result"]["notion_writeback"]["deferred"]
            self.assertEqual(deferred["tool_id"], "notion.controller")
            self.assertEqual(deferred["input"]["action"], "append-text")
            self.assertIn("done", deferred["input"]["text"])
            control.set_kill(tmp, True)
            self.assertTrue(control.killed(tmp))
            self.assertEqual(control.gate(tmp)["status"], "blocked")
            cloud = manus.run_local({"goal": "x", "transport": "api", "state_dir": tmp, "project_id": "gated"})
            self.assertIn("Kill switch", cloud["limitations"][0])

    def test_notion_writeback_sends_only_when_gated(self):
        import os
        with tempfile.TemporaryDirectory() as tmp:
            calls = []
            original = orchestrator._append_notion

            def fake_append(page_id, text):
                calls.append((page_id, text))
                return {"object": "list"}

            orchestrator._append_notion = fake_append
            os.environ["NOTION_API_KEY"] = "test-only"
            try:
                sent = orchestrator.run({
                    "action": "synthesize",
                    "state_dir": tmp,
                    "tier": 0,
                    "notion_page_id": "4141aa27632381dcbf2af2d83d16c60d",
                    "approval": {"approved": True, "id": "human-1"},
                    "evidence": {
                        "summary": "package",
                        "artifact_files": ["objective.md"],
                        "evidence_log": ["objective.md"],
                        "limitations": ["local only"],
                    },
                })
            finally:
                os.environ.pop("NOTION_API_KEY", None)
                orchestrator._append_notion = original
            self.assertEqual(sent["status"], "ready")
            self.assertTrue(sent["result"]["notion_writeback"]["sent"])
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][0], "4141aa27632381dcbf2af2d83d16c60d")
            self.assertIn("package", calls[0][1])

    def test_phase6_fleet_wake_does_not_spawn(self):
        with tempfile.TemporaryDirectory() as tmp:
            woken = control.wake(tmp, "painter")
            self.assertEqual(woken["status"], "ready")
            self.assertFalse(woken["result"]["spawned"])
            unknown = control.wake(tmp, "not-a-fleet-agent")
            self.assertEqual(unknown["status"], "blocked")

    def test_cloud_and_webhook_are_not_pretended(self):
        with tempfile.TemporaryDirectory() as tmp:
            api = manus.run_local({
                "goal": "Run in the cloud.", "transport": "api",
                "state_dir": tmp, "project_id": "cloud", "tier": 0,
            })
            hook = manus.run_local({
                "goal": "Run in the cloud.", "transport": "webhook",
                "state_dir": tmp, "project_id": "cloud", "tier": 0,
            })
            self.assertEqual(api["status"], "blocked")
            self.assertIn("not called", api["limitations"][0])
            self.assertIn("No webhook was sent", hook["limitations"][0])


if __name__ == "__main__":
    unittest.main()
