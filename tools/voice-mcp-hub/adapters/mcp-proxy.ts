import type { AdapterFactory } from "../adapter-interface.ts";

/**
 * Forwards to an EXTERNAL MCP server (e.g. hosted ElevenLabs MCP) over streamable HTTP.
 * Caps response size. Never prints secrets (VOICE_MCP_PROXY_URL / VOICE_MCP_PROXY_TOKEN).
 */
const MAX_PROXY_CHARS = 200_000;

export const createAdapter: AdapterFactory = (env) => {
  const url = (env.VOICE_MCP_PROXY_URL || "").trim();
  const token = (env.VOICE_MCP_PROXY_TOKEN || "").trim();
  const configured = Boolean(url);
  return {
    id: "mcp-proxy",
    label: "External MCP proxy",
    disabled: !configured,
    async health() {
      if (!configured) {
        return {
          ok: false,
          status: "not_configured",
          detail: "VOICE_MCP_PROXY_URL is not set.",
          watermark: null,
          backend: "mcp-proxy",
        };
      }
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list",
            params: {},
          }),
          signal: AbortSignal.timeout(8_000),
        });
        const text = await res.text();
        if (text.length > MAX_PROXY_CHARS) {
          return { ok: false, status: "too_large", detail: "External MCP response too large.", backend: "mcp-proxy", watermark: null };
        }
        return {
          ok: res.ok,
          status: res.ok ? "ok" : `http_${res.status}`,
          detail: res.ok ? "External MCP responded to tools/list." : `External MCP returned ${res.status}.`,
          backend: "mcp-proxy",
          watermark: null,
        };
      } catch {
        return { ok: false, status: "down", detail: "External MCP did not answer.", backend: "mcp-proxy", watermark: null };
      }
    },
    async listVoices() {
      return [];
    },
    async createVoice() {
      if (!configured) throw new Error("mcp-proxy not configured.");
      throw new Error(
        "mcp-proxy create_voice requires mapping to the external server's tool names — configure VOICE_MCP_PROXY_CREATE_TOOL or use a dedicated adapter.",
      );
    },
    async synthesize() {
      if (!configured) throw new Error("mcp-proxy not configured.");
      throw new Error("mcp-proxy synthesize requires VOICE_MCP_PROXY_SYNTH_TOOL mapping.");
    },
    async deleteVoice() {
      return { deleted: false };
    },
  };
};

export default createAdapter;
