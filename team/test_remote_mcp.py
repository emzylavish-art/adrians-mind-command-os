import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import remote_mcp


class RemoteMCPConfigTests(unittest.TestCase):
    def test_disabled_server_is_blocked(self):
        with patch.object(remote_mcp, "load_config", return_value={"servers": {"demo": {"enabled": False, "url": "https://example.com/mcp"}}}):
            with self.assertRaises(remote_mcp.RemoteMCPError):
                remote_mcp._server("demo")

    def test_http_endpoint_is_blocked(self):
        config = {"servers": {"demo": {"enabled": True, "url": "http://example.com/mcp"}}}
        with self.assertRaises(remote_mcp.RemoteMCPError):
            remote_mcp._server("demo", config)

    def test_embedded_credentials_are_blocked(self):
        config = {"servers": {"demo": {"enabled": True, "url": "https://user:pass@example.com/mcp"}}}
        with self.assertRaises(remote_mcp.RemoteMCPError):
            remote_mcp._server("demo", config)

    def test_token_is_read_from_environment(self):
        config = {"servers": {"demo": {"enabled": True, "url": "https://example.com/mcp", "token_env": "DEMO_MCP_TOKEN"}}}
        with patch.dict(os.environ, {"DEMO_MCP_TOKEN": "secret"}):
            self.assertEqual(remote_mcp._server("demo", config)[1], "secret")
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(remote_mcp.RemoteMCPError):
                remote_mcp._server("demo", config)

    def test_tool_call_requires_explicit_allowlist(self):
        config = {"servers": {"demo": {"enabled": True, "url": "https://example.com/mcp", "allowed_tools": ["read"]}}}
        with patch.object(remote_mcp, "_server", return_value=("https://example.com/mcp", None, config["servers"]["demo"])), patch.object(remote_mcp, "_rpc") as rpc, patch.object(remote_mcp, "_post"):
            rpc.side_effect = [{"ok": True}, None, {"content": [{"type": "text", "text": "ok"}]}]
            result = remote_mcp.call_tool("demo", "read", {})
            self.assertEqual(result["tool"], "read")
            with self.assertRaises(remote_mcp.RemoteMCPError):
                remote_mcp.call_tool("demo", "write", {})


if __name__ == "__main__":
    unittest.main()
