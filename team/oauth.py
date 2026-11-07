#!/usr/bin/env python3
"""Small OAuth 2.1 authorization-code/PKCE service for the MCP bridge.

The class is transport agnostic so the local HTTP server and a Cloudflare
Worker adapter can share the security-critical validation. Tokens are opaque,
stored as hashes, and never returned from logs or persistence.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlencode, urlparse


class OAuthError(ValueError):
    def __init__(self, error: str, description: str, status: int = 400):
        super().__init__(description)
        self.error = error
        self.description = description
        self.status = status


@dataclass(frozen=True)
class Client:
    client_id: str
    redirect_uris: tuple[str, ...]
    public: bool = True


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _safe_redirect(uri: str) -> bool:
    parsed = urlparse(uri)
    return bool(parsed.scheme and parsed.netloc and parsed.fragment == "")


class OAuthManager:
    """In-memory OAuth state suitable for one Worker instance or local tests."""

    def __init__(self, issuer: str, *, audience: str | None = None, ttl: int = 600,
                 access_ttl: int = 3600, secret: str | None = None):
        if not issuer.startswith("https://"):
            raise ValueError("OAuth issuer must be an HTTPS URL")
        self.issuer = issuer.rstrip("/")
        self.audience = audience or self.issuer
        self.ttl = max(60, int(ttl))
        self.access_ttl = max(60, int(access_ttl))
        self.refresh_ttl = max(self.access_ttl, 30 * 24 * 60 * 60)
        self.secret = (secret or secrets.token_urlsafe(32)).encode("utf-8")
        self.clients: dict[str, Client] = {}
        self.codes: dict[str, dict] = {}
        self.tokens: dict[str, dict] = {}
        self.revoked: set[str] = set()

    def register_client(self, client_id: str, redirect_uris: list[str] | tuple[str, ...], *, public: bool = True):
        if not client_id or not redirect_uris or any(not _safe_redirect(uri) for uri in redirect_uris):
            raise OAuthError("invalid_client_metadata", "A client id and valid redirect URIs are required.")
        self.clients[client_id] = Client(client_id, tuple(redirect_uris), public)

    def metadata(self) -> dict:
        return {
            "issuer": self.issuer,
            "authorization_endpoint": f"{self.issuer}/oauth/authorize",
            "token_endpoint": f"{self.issuer}/oauth/token",
            "revocation_endpoint": f"{self.issuer}/oauth/revoke",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "code_challenge_methods_supported": ["S256"],
            "scopes_supported": ["mind.tools"],
            "token_endpoint_auth_methods_supported": ["none"],
        }

    def protected_resource_metadata(self) -> dict:
        return {
            "resource": self.audience,
            "authorization_servers": [self.issuer],
            "scopes_supported": ["mind.tools"],
            "bearer_methods_supported": ["header"],
        }

    def authorize(self, params: dict, *, subject: str, now: int | None = None) -> str:
        now = int(time.time() if now is None else now)
        client_id = params.get("client_id", "")
        client = self.clients.get(client_id)
        redirect_uri = params.get("redirect_uri", "")
        if not client or redirect_uri not in client.redirect_uris:
            raise OAuthError("invalid_request", "Unknown client or redirect URI.")
        if params.get("response_type") != "code":
            raise OAuthError("unsupported_response_type", "Only response_type=code is supported.")
        if params.get("code_challenge_method") != "S256" or not params.get("code_challenge"):
            raise OAuthError("invalid_request", "PKCE S256 is required.")
        scopes = tuple(filter(None, str(params.get("scope", "")).split()))
        if not scopes or any(scope != "mind.tools" for scope in scopes):
            raise OAuthError("invalid_scope", "Only the mind.tools scope is supported.")
        code = secrets.token_urlsafe(32)
        self.codes[_hash(code)] = {
            "client_id": client_id, "redirect_uri": redirect_uri,
            "challenge": params["code_challenge"], "subject": subject,
            "scope": " ".join(scopes), "expires": now + self.ttl,
        }
        query = {"code": code}
        if params.get("state") is not None:
            query["state"] = params["state"]
        return redirect_uri + ("&" if "?" in redirect_uri else "?") + urlencode(query)

    def exchange(self, params: dict, *, now: int | None = None) -> dict:
        now = int(time.time() if now is None else now)
        grant_type = params.get("grant_type", "authorization_code")
        if grant_type not in {"authorization_code", "refresh_token"}:
            raise OAuthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported.")
        if grant_type == "refresh_token":
            refresh_hash = _hash(params.get("refresh_token", ""))
            previous = next((record for record in self.tokens.values() if record.get("refresh_hash") == refresh_hash), None)
            if not previous or previous.get("refresh_expires", 0) <= now:
                raise OAuthError("invalid_grant", "Refresh token is invalid or expired.")
            if params.get("client_id") != previous["client_id"]:
                raise OAuthError("invalid_grant", "Client does not match refresh token.")
            access = secrets.token_urlsafe(48)
            refresh = secrets.token_urlsafe(48)
            self.tokens[_hash(access)] = {
                "subject": previous["subject"], "client_id": previous["client_id"],
                "scope": previous["scope"], "aud": self.audience, "expires": now + self.access_ttl,
                "refresh_expires": now + self.refresh_ttl,
                "refresh_hash": _hash(refresh),
            }
            previous["refresh_hash"] = _hash("revoked-" + secrets.token_urlsafe(16))
            return {"access_token": access, "token_type": "Bearer", "expires_in": self.access_ttl,
                    "scope": previous["scope"], "refresh_token": refresh}
        code = params.get("code", "")
        record = self.codes.pop(_hash(code), None)
        if not record or record["expires"] <= now:
            raise OAuthError("invalid_grant", "Authorization code is invalid or expired.")
        if params.get("client_id") != record["client_id"] or params.get("redirect_uri") != record["redirect_uri"]:
            raise OAuthError("invalid_grant", "Client or redirect URI does not match authorization code.")
        verifier = params.get("code_verifier", "")
        if _b64(hashlib.sha256(verifier.encode("ascii")).digest()) != record["challenge"]:
            raise OAuthError("invalid_grant", "PKCE verification failed.")
        access = secrets.token_urlsafe(48)
        refresh = secrets.token_urlsafe(48)
        self.tokens[_hash(access)] = {
            "subject": record["subject"], "client_id": record["client_id"],
            "scope": record["scope"], "aud": self.audience, "expires": now + self.access_ttl,
            "refresh_expires": now + self.refresh_ttl,
            "refresh_hash": _hash(refresh),
        }
        return {"access_token": access, "token_type": "Bearer", "expires_in": self.access_ttl,
                "scope": record["scope"], "refresh_token": refresh}

    def validate(self, token: str, *, scope: str = "mind.tools", audience: str | None = None,
                 now: int | None = None) -> dict:
        now = int(time.time() if now is None else now)
        record = self.tokens.get(_hash(token))
        if not record or record["expires"] <= now:
            raise OAuthError("invalid_token", "Access token is invalid or expired.", 401)
        if audience is not None and not hmac.compare_digest(record["aud"], audience):
            raise OAuthError("invalid_token", "Access token audience is invalid.", 401)
        if scope not in record["scope"].split():
            raise OAuthError("insufficient_scope", "Access token does not grant the requested scope.", 403)
        return {"sub": record["subject"], "client_id": record["client_id"], "scope": record["scope"], "aud": record["aud"]}

    def revoke(self, token: str) -> None:
        token_hash = _hash(token)
        self.revoked.add(token_hash)
        self.tokens.pop(token_hash, None)
        for access_hash, record in list(self.tokens.items()):
            if record.get("refresh_hash") == token_hash:
                self.tokens.pop(access_hash, None)

