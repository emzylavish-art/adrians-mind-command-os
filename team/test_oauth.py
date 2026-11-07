import hashlib
import base64
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from oauth import OAuthError, OAuthManager


class OAuthTests(unittest.TestCase):
    def setUp(self):
        self.oauth = OAuthManager("https://mcp.example.test", audience="https://mcp.example.test/mcp", secret="test-secret")
        self.oauth.register_client("client", ["https://client.example.test/callback"])
        self.verifier = "verifier-value"
        self.challenge = base64.urlsafe_b64encode(hashlib.sha256(self.verifier.encode()).digest()).rstrip(b"=").decode()
        self.params = {
            "response_type": "code", "client_id": "client", "redirect_uri": "https://client.example.test/callback",
            "scope": "mind.tools", "code_challenge_method": "S256", "code_challenge": self.challenge, "state": "state-1",
        }

    def test_discovery_metadata(self):
        metadata = self.oauth.metadata()
        self.assertEqual(metadata["code_challenge_methods_supported"], ["S256"])
        self.assertEqual(metadata["authorization_endpoint"], "https://mcp.example.test/oauth/authorize")

    def test_pkce_exchange_and_validation(self):
        location = self.oauth.authorize(self.params, subject="owner@example.test", now=100)
        code = location.split("code=", 1)[1].split("&", 1)[0]
        token = self.oauth.exchange({"code": code, "client_id": "client", "redirect_uri": self.params["redirect_uri"], "code_verifier": self.verifier}, now=100)
        claims = self.oauth.validate(token["access_token"], audience="https://mcp.example.test/mcp", now=100)
        self.assertEqual(claims["sub"], "owner@example.test")

    def test_invalid_redirect_and_pkce_are_rejected(self):
        with self.assertRaises(OAuthError):
            self.oauth.authorize({**self.params, "redirect_uri": "https://evil.example/callback"}, subject="owner")
        location = self.oauth.authorize(self.params, subject="owner", now=100)
        code = location.split("code=", 1)[1].split("&", 1)[0]
        with self.assertRaisesRegex(OAuthError, "PKCE"):
            self.oauth.exchange({"code": code, "client_id": "client", "redirect_uri": self.params["redirect_uri"], "code_verifier": "wrong"}, now=100)

    def test_expiry_audience_scope_and_revocation(self):
        location = self.oauth.authorize(self.params, subject="owner", now=100)
        code = location.split("code=", 1)[1].split("&", 1)[0]
        token = self.oauth.exchange({"code": code, "client_id": "client", "redirect_uri": self.params["redirect_uri"], "code_verifier": self.verifier}, now=100)
        with self.assertRaises(OAuthError):
            self.oauth.validate(token["access_token"], audience="wrong", now=100)
        self.oauth.revoke(token["access_token"])
        with self.assertRaisesRegex(OAuthError, "invalid or expired"):
            self.oauth.validate(token["access_token"], now=100)

    def test_refresh_tokens_rotate(self):
        location = self.oauth.authorize(self.params, subject="owner", now=100)
        code = location.split("code=", 1)[1].split("&", 1)[0]
        token = self.oauth.exchange({"code": code, "client_id": "client", "redirect_uri": self.params["redirect_uri"], "code_verifier": self.verifier}, now=100)
        refreshed = self.oauth.exchange({"grant_type": "refresh_token", "refresh_token": token["refresh_token"], "client_id": "client"}, now=101)
        self.assertNotEqual(refreshed["access_token"], token["access_token"])
        with self.assertRaises(OAuthError):
            self.oauth.exchange({"grant_type": "refresh_token", "refresh_token": token["refresh_token"], "client_id": "client"}, now=101)
        self.oauth.revoke(refreshed["refresh_token"])
        with self.assertRaises(OAuthError):
            self.oauth.validate(refreshed["access_token"], now=101)


if __name__ == "__main__":
    unittest.main()
