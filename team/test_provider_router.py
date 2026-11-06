import json
import os
import unittest
from unittest.mock import MagicMock, patch

import provider_router


class ProviderRouterTests(unittest.TestCase):
    def test_unknown_provider_is_rejected(self):
        with self.assertRaises(provider_router.ProviderError):
            provider_router.generate("unknown", [{"role": "user", "content": "hi"}])

    def test_grok_requires_environment_key(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(provider_router.ProviderError, "XAI_API_KEY"):
                provider_router.generate("grok", [{"role": "user", "content": "hi"}])

    def test_status_does_not_claim_external_connection(self):
        with patch.dict(os.environ, {}, clear=True):
            status = provider_router.provider_status()
        self.assertFalse(status["grok"]["configured"])
        self.assertFalse(status["openrouter"]["configured"])
        self.assertTrue(status["ollama"]["configured"])
        self.assertTrue(status["ollama"]["requires_local_service"])

    def test_paid_route_requires_budget_configuration(self):
        with patch.dict(os.environ, {"XAI_API_KEY": "test-token"}, clear=True):
            with self.assertRaisesRegex(provider_router.ProviderError, "budget preflight"):
                provider_router.generate("grok", [{"role": "user", "content": "hi"}])

    def test_paid_route_pauses_at_budget_exhaustion(self):
        env = {
            "XAI_API_KEY": "test-token",
            "MIND_COMMAND_BUDGET_LIMIT_USD": "1",
            "MIND_COMMAND_BUDGET_SPENT_USD": "1",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaisesRegex(provider_router.ProviderError, "budget is exhausted"):
                provider_router.generate("grok", [{"role": "user", "content": "hi"}])

    def test_openrouter_response_is_parsed(self):
        response = MagicMock()
        response.read.return_value = json.dumps({
            "choices": [{"message": {"content": "hello"}}]
        }).encode()
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
        self.assertEqual(result["provider"], "openrouter")

    def test_openai_requires_environment_key(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(provider_router.ProviderError, "OPENAI_API_KEY"):
                provider_router.generate("openai", [{"role": "user", "content": "hi"}])

    def test_openai_resolves_astra_and_reports_usage(self):
        models = MagicMock()
        models.read.return_value = json.dumps({"data": [{"id": "gpt-6-astra"}, {"id": "gpt-6.1-sol"}]}).encode()
        models.__enter__.return_value = models
        response = MagicMock()
        response.read.return_value = json.dumps({
            "output_text": "hello from astra",
            "usage": {"input_tokens": 3, "output_tokens": 4, "total_tokens": 7},
        }).encode()
        response.__enter__.return_value = response
        env = {
            "OPENAI_API_KEY": "test-token",
            "MIND_COMMAND_BUDGET_LIMIT_USD": "10",
            "MIND_COMMAND_BUDGET_SPENT_USD": "0",
        }
        with patch.dict(os.environ, env, clear=True), patch.object(
            provider_router.urllib.request, "urlopen", side_effect=[models, response]
        ):
            result = provider_router.generate("openai", [{"role": "user", "content": "hi"}])
        self.assertEqual(result["provider"], "openai")
        self.assertEqual(result["model"], "gpt-6-astra")
        self.assertEqual(result["alias"], "astra")
        self.assertEqual(result["usage"]["total_tokens"], 7)

    def test_openai_rejects_unlisted_model(self):
        models = MagicMock()
        models.read.return_value = json.dumps({"data": [{"id": "gpt-6.1-sol"}]}).encode()
        models.__enter__.return_value = models
        env = {
            "OPENAI_API_KEY": "test-token",
            "MIND_COMMAND_BUDGET_LIMIT_USD": "10",
            "MIND_COMMAND_BUDGET_SPENT_USD": "0",
        }
        with patch.dict(os.environ, env, clear=True), patch.object(
            provider_router.urllib.request, "urlopen", return_value=models
        ):
            with self.assertRaisesRegex(provider_router.ProviderError, "not listed"):
                provider_router.generate("openai", [{"role": "user", "content": "hi"}], model="unsupported")


if __name__ == "__main__":
    unittest.main()
