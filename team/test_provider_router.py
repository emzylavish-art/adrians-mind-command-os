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

    def test_astra_sol_luna_route_order_is_explicit(self):
        env = {
            "ASTRA_API_BASE_URL": "https://astra.example.test/v1/chat/completions",
            "ASTRA_API_KEY": "astra-test", "ASTRA_MODEL": "astra-test-model",
            "SOL_API_BASE_URL": "https://sol.example.test/v1/chat/completions",
            "SOL_API_KEY": "sol-test", "SOL_MODEL": "sol-test-model",
            "LUNA_API_BASE_URL": "https://luna.example.test/v1/chat/completions",
            "LUNA_API_KEY": "luna-test", "LUNA_MODEL": "luna-test-model",
            "MIND_COMMAND_BUDGET_LIMIT_USD": "10", "MIND_COMMAND_BUDGET_SPENT_USD": "0",
        }
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(provider_router.route_order(), ["astra", "sol", "luna"])

    def test_routing_falls_back_without_claiming_unavailable_model(self):
        env = {
            "ASTRA_API_BASE_URL": "https://astra.example.test/v1/chat/completions", "ASTRA_API_KEY": "a", "ASTRA_MODEL": "astra",
            "SOL_API_BASE_URL": "https://sol.example.test/v1/chat/completions", "SOL_API_KEY": "s", "SOL_MODEL": "sol",
            "MIND_COMMAND_BUDGET_LIMIT_USD": "10", "MIND_COMMAND_BUDGET_SPENT_USD": "0",
        }
        responses = []
        for content in (b'{"error":"down"}', b'{"choices":[{"message":{"content":"sol ok"}}]}'):
            response = MagicMock()
            response.read.return_value = content
            response.__enter__.return_value = response
            responses.append(response)
        def call(request, timeout):
            response = responses.pop(0)
            if b"error" in response.read.return_value:
                raise provider_router.urllib.error.HTTPError(request.full_url, 503, "down", {}, None)
            return response
        with patch.dict(os.environ, env, clear=True), patch.object(provider_router.urllib.request, "urlopen", side_effect=call):
            result = provider_router.generate_routed([{"role": "user", "content": "hi"}])
        self.assertEqual(result["provider"], "sol")
        self.assertEqual(result["route"]["selected"], "sol")

    def test_openai_compatible_stream_is_reassembled(self):
        response = MagicMock()
        response.read.return_value = (
            b'data: {"choices":[{"delta":{"content":"hel"}}]}\n'
            b'data: {"choices":[{"delta":{"content":"lo"}}]}\n'
            b'data: [DONE]\n'
        )
        response.__enter__.return_value = response
        env = {
            "ASTRA_API_BASE_URL": "https://astra.example.test/v1/chat/completions",
            "ASTRA_API_KEY": "test-token", "ASTRA_MODEL": "astra-test",
            "MIND_COMMAND_BUDGET_LIMIT_USD": "10", "MIND_COMMAND_BUDGET_SPENT_USD": "0",
        }
        with patch.dict(os.environ, env, clear=True), patch.object(
            provider_router.urllib.request, "urlopen", return_value=response
        ):
            result = provider_router.generate("astra", [{"role": "user", "content": "hi"}], stream=True)
        self.assertEqual(result["content"], "hello")
        self.assertTrue(result["streamed"])

    def test_openai_compatible_route_uses_exact_configured_model(self):
        response = MagicMock()
        response.read.return_value = b'{"choices":[{"message":{"content":"api reply"}}]}'
        response.__enter__.return_value = response
        env = {
            "OPENAI_API_BASE_URL": "https://api.example.test/v1/chat/completions",
            "OPENAI_API_KEY": "test-token", "OPENAI_MODEL": "provider-model",
            "MIND_COMMAND_BUDGET_LIMIT_USD": "10", "MIND_COMMAND_BUDGET_SPENT_USD": "0",
        }
        with patch.dict(os.environ, env, clear=True), patch.object(
            provider_router.urllib.request, "urlopen", return_value=response
        ):
            result = provider_router.generate("openai", [{"role": "user", "content": "hi"}])
        self.assertEqual(result["model"], "provider-model")
        self.assertEqual(result["content"], "api reply")


if __name__ == "__main__":
    unittest.main()
