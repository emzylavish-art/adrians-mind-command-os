import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import provider_router


class ProviderRouterTests(unittest.TestCase):
    def test_unknown_provider_is_rejected(self):
        with self.assertRaises(provider_router.ProviderError):
            provider_router.generate("unknown", [{"role": "user", "content": "hi"}])

    def test_grok_requires_any_scoped_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"XAI_KEYS_DIR": tmp}
            with patch.dict(os.environ, env, clear=True), patch.object(
                provider_router, "read_xai_scoped_key_file", return_value=None
            ):
                with self.assertRaisesRegex(provider_router.ProviderError, "scoped xAI"):
                    provider_router.generate(
                        "grok", [{"role": "user", "content": "hi"}], role="analysis",
                        keys_dir=tmp,
                    )

    def test_openai_requires_environment_key(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(provider_router.ProviderError, "OPENAI_API_KEY"):
                provider_router.generate("openai", [{"role": "user", "content": "hi"}])

    def test_per_bot_key_preferred_over_env_and_shared(self):
        with tempfile.TemporaryDirectory() as tmp:
            keys = Path(tmp)
            (keys / "provider-router.key").write_text("  bot-dummy  \n", encoding="utf-8")
            env = {
                "XAI_API_KEY": "env-dummy",
                "XAI_KEYS_DIR": str(keys),
                "FLEET_BOT_NAME": "provider-router",
            }
            shared = keys / "shared"
            shared.write_text("shared-dummy", encoding="utf-8")
            resolved = provider_router.resolve_xai_key(
                env=env, secrets_path=shared, keys_dir=keys, bot="provider-router"
            )
            self.assertEqual(resolved["key_source"], "per_bot_file")
            self.assertEqual(resolved["key"], "bot-dummy")
            self.assertEqual(resolved["bot"], "provider-router")

    def test_env_key_used_when_per_bot_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            keys = Path(tmp)
            env = {"XAI_API_KEY": "env-dummy", "XAI_KEYS_DIR": str(keys)}
            resolved = provider_router.resolve_xai_key(
                env=env, secrets_path=keys / "missing", keys_dir=keys
            )
            self.assertEqual(resolved["key_source"], "env")
            self.assertEqual(resolved["key"], "env-dummy")

    def test_shared_file_fallback_when_per_bot_and_env_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            keys = Path(tmp)
            shared = keys / "XAI_API_KEY"
            shared.write_text("  shared-dummy  \n", encoding="utf-8")
            resolved = provider_router.resolve_xai_key(
                env={"XAI_KEYS_DIR": str(keys)},
                secrets_path=shared,
                keys_dir=keys,
                bot="provider-router",
            )
            self.assertEqual(resolved["key_source"], "file")
            self.assertEqual(resolved["key"], "shared-dummy")

    def test_fleet_bot_name_selects_key_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            keys = Path(tmp)
            (keys / "error-bot.key").write_text("error-dummy", encoding="utf-8")
            (keys / "provider-router.key").write_text("pr-dummy", encoding="utf-8")
            resolved = provider_router.resolve_xai_key(
                env={"FLEET_BOT_NAME": "error-bot", "XAI_KEYS_DIR": str(keys)},
                keys_dir=keys,
            )
            self.assertEqual(resolved["bot"], "error-bot")
            self.assertEqual(resolved["key"], "error-dummy")

    def test_xai_keys_dir_env_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            keys = Path(tmp)
            (keys / "provider-router.key").write_text("dir-dummy", encoding="utf-8")
            resolved = provider_router.resolve_xai_key(
                env={"XAI_KEYS_DIR": str(keys)},
            )
            self.assertEqual(resolved["key_source"], "per_bot_file")
            self.assertEqual(resolved["key"], "dir-dummy")

    def test_missing_all_sources_fails_loud(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(provider_router.ProviderError, "scoped xAI"):
                provider_router.resolve_xai_key(
                    env={"XAI_KEYS_DIR": tmp},
                    secrets_path=Path(tmp) / "nope",
                    keys_dir=tmp,
                )

    def test_status_policy_lists_per_bot_paths(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(
            os.environ, {"XAI_KEYS_DIR": tmp}, clear=True
        ), patch.object(provider_router, "read_xai_scoped_key_file", return_value=None):
            # no per-bot key either
            status = provider_router.provider_status(env={"XAI_KEYS_DIR": tmp})
        self.assertEqual(status["key_policy"]["execution_testing"], "OPENAI_API_KEY")
        self.assertEqual(status["key_policy"]["xai_scoped"], "XAI_API_KEY")
        self.assertEqual(status["key_policy"]["xai_keys_dir"], "/home/box/.secrets/xai")
        self.assertEqual(status["key_policy"]["default_bot"], "provider-router")
        self.assertNotIn("analysis_fallback", status["key_policy"])

    def test_paid_route_requires_budget_configuration(self):
        with tempfile.TemporaryDirectory() as tmp:
            keys = Path(tmp)
            (keys / "provider-router.key").write_text("test-token", encoding="utf-8")
            with patch.dict(os.environ, {"XAI_KEYS_DIR": str(keys)}, clear=True):
                with self.assertRaisesRegex(provider_router.ProviderError, "budget preflight"):
                    provider_router.generate(
                        "grok", [{"role": "user", "content": "hi"}], role="analysis",
                        keys_dir=keys,
                    )

    def test_paid_route_pauses_at_budget_exhaustion(self):
        with tempfile.TemporaryDirectory() as tmp:
            keys = Path(tmp)
            (keys / "provider-router.key").write_text("test-token", encoding="utf-8")
            env = {
                "XAI_KEYS_DIR": str(keys),
                "MIND_COMMAND_BUDGET_LIMIT_USD": "1",
                "MIND_COMMAND_BUDGET_SPENT_USD": "1",
            }
            with patch.dict(os.environ, env, clear=True):
                with self.assertRaisesRegex(provider_router.ProviderError, "budget is exhausted"):
                    provider_router.generate(
                        "grok", [{"role": "user", "content": "hi"}], role="analysis",
                        keys_dir=keys,
                    )

    def test_openrouter_response_is_parsed(self):
        response = MagicMock()
        response.read.return_value = json.dumps({
            "choices": [{"message": {"content": "hello"}}]
        }).encode()
        response.status = 200
        response.getcode.return_value = 200
        response.__enter__.return_value = response
        env = {
            "OPENROUTER_API_KEY": "test-token",
            "MIND_COMMAND_BUDGET_LIMIT_USD": "10",
            "MIND_COMMAND_BUDGET_SPENT_USD": "0",
        }
        with patch.dict(os.environ, env, clear=True), patch.object(
            provider_router.urllib.request, "urlopen", return_value=response
        ):
            result = provider_router.generate(
                "openrouter", [{"role": "user", "content": "hi"}]
            )
        self.assertEqual(result["content"], "hello")

    def test_openai_response_is_parsed(self):
        response = MagicMock()
        response.read.return_value = json.dumps({
            "choices": [{"message": {"content": "ok-gpt"}}]
        }).encode()
        response.status = 200
        response.getcode.return_value = 200
        response.__enter__.return_value = response
        env = {
            "OPENAI_API_KEY": "test-token",
            "MIND_COMMAND_BUDGET_LIMIT_USD": "10",
            "MIND_COMMAND_BUDGET_SPENT_USD": "0",
        }
        with patch.dict(os.environ, env, clear=True), patch.object(
            provider_router.urllib.request, "urlopen", return_value=response
        ):
            result = provider_router.generate(
                "openai", [{"role": "user", "content": "hi"}], max_tokens=5
            )
        self.assertEqual(result["content"], "ok-gpt")
        self.assertEqual(result["http_status"], 200)

    def test_active_brain_env_reread_on_every_call(self):
        self.assertEqual(
            provider_router.read_active_brain(env={"MIND_ACTIVE_BRAIN": "gpt"}), "gpt"
        )
        self.assertEqual(
            provider_router.read_active_brain(env={"MIND_ACTIVE_BRAIN": "xai"}), "xai"
        )

    def test_active_brain_file_reread_on_every_call(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "active_brain.json"
            path.write_text(json.dumps({"active_brain": "gpt"}), encoding="utf-8")
            self.assertEqual(
                provider_router.read_active_brain(env={}, brain_file=path), "gpt"
            )
            path.write_text(json.dumps({"active_brain": "xai"}), encoding="utf-8")
            self.assertEqual(
                provider_router.read_active_brain(env={}, brain_file=path), "xai"
            )

    def test_switch_on_next_call_changes_lane_resolution(self):
        before = provider_router.resolve_provider_for_lane(
            "team.provider_router.generate", env={"MIND_ACTIVE_BRAIN": "gpt"}
        )
        after = provider_router.resolve_provider_for_lane(
            "team.provider_router.generate", env={"MIND_ACTIVE_BRAIN": "xai"}
        )
        self.assertEqual(before["provider"], "openai")
        self.assertEqual(after["provider"], "grok")

    def test_verify_lanes_covers_every_registered_lane(self):
        report = provider_router.verify_lanes(env={"MIND_ACTIVE_BRAIN": "gpt"})
        self.assertEqual(report["lane_count"], len(provider_router.LANES))
        self.assertTrue(report["all_follow_active_brain"])

    def test_role_defaults_match_global_rules(self):
        self.assertEqual(provider_router.ROLE_DEFAULTS["execution"], "gpt")
        self.assertEqual(provider_router.ROLE_DEFAULTS["testing"], "gpt")
        self.assertEqual(provider_router.ROLE_DEFAULTS["analysis"], "xai")

    def test_no_management_key_on_call_path(self):
        src = Path(provider_router.__file__).read_text(encoding="utf-8")
        lines = [
            line
            for line in src.splitlines()
            if "XAI_MANAGEMENT_API_KEY" in line
            and not line.lstrip().startswith("#")
            and not line.lstrip().startswith("- ")
        ]
        self.assertEqual(lines, [])


if __name__ == "__main__":
    unittest.main()
