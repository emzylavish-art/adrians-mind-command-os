import json
import os
import unittest
from unittest.mock import Mock, patch

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

    def test_openrouter_response_is_parsed(self):
        response = Mock()\n        response.read.return_value = json.dumps({\n            "choices": [{"message": {"content": "hello"}}]\n        }).encode()\n        response.__enter__.return_value = response
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-token"}), patch.object(
            provider_router.urllib.request, "urlopen", return_value=response
        ):
            result = provider_router.generate(
                "openrouter", [{"role": "user", "content": "hi"}]
            )
        self.assertEqual(result["content"], "hello")
        self.assertEqual(result["provider"], "openrouter")


if __name__ == "__main__":
    unittest.main()
