/**
 * MCP server entry for Voice Connection Hub.
 * Transports: stdio (local) or streamable HTTP when VOICE_HUB_HTTP=1.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createVoiceHub } from "./hub.ts";

function asText(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    isError,
  };
}

export async function createHubMcpServer() {
  const hub = await createVoiceHub();
  const server = new McpServer({ name: "adrians-mind-voice-hub", version: "0.1.0" });

  server.registerTool("list_providers", { description: "List Voice Hub adapters and health." }, async () => {
    try {
      return asText(await hub.listProviders());
    } catch (err) {
      return asText({ error: err instanceof Error ? err.message : "list_providers failed" }, true);
    }
  });

  server.registerTool(
    "health",
    {
      description: "Health for default or named provider.",
      inputSchema: { provider_id: z.string().optional() },
    },
    async ({ provider_id }) => {
      try {
        return asText(await hub.health(provider_id));
      } catch (err) {
        return asText({ error: err instanceof Error ? err.message : "health failed" }, true);
      }
    },
  );

  server.registerTool(
    "create_voice",
    {
      description: "Create a cloned voice. Requires studio consent_token + consent_record_id.",
      inputSchema: {
        provider_id: z.string().optional(),
        name: z.string(),
        profile_id: z.string().optional(),
        consent_token: z.string(),
        consent_record_id: z.string(),
        file_base64: z.string(),
        filename: z.string(),
        mime: z.string(),
      },
    },
    async (args) => {
      try {
        const fileBytes = Uint8Array.from(Buffer.from(args.file_base64, "base64"));
        const result = await hub.createVoice({
          providerId: args.provider_id,
          name: args.name,
          profileId: args.profile_id,
          consentToken: args.consent_token,
          consentRecordId: args.consent_record_id,
          fileBytes,
          filename: args.filename,
          mime: args.mime,
        });
        return asText(result);
      } catch (err) {
        return asText({ error: err instanceof Error ? err.message : "create_voice failed" }, true);
      }
    },
  );

  server.registerTool(
    "synthesize",
    {
      description: "Synthesize speech with a provider voice id.",
      inputSchema: {
        provider_id: z.string().optional(),
        voice_id: z.string(),
        text: z.string(),
        format: z.enum(["wav", "mp3"]).optional(),
      },
    },
    async (args) => {
      try {
        const result = await hub.synthesize({
          providerId: args.provider_id,
          voiceId: args.voice_id,
          text: args.text,
          format: args.format,
        });
        return asText({
          providerId: result.providerId,
          mime: result.mime,
          audio_base64: Buffer.from(result.bytes).toString("base64"),
        });
      } catch (err) {
        return asText({ error: err instanceof Error ? err.message : "synthesize failed" }, true);
      }
    },
  );

  server.registerTool(
    "delete_voice",
    {
      description: "Delete a provider-side voice.",
      inputSchema: { provider_id: z.string().optional(), voice_id: z.string() },
    },
    async ({ provider_id, voice_id }) => {
      try {
        return asText(await hub.deleteVoice({ providerId: provider_id, voiceId: voice_id }));
      } catch (err) {
        return asText({ error: err instanceof Error ? err.message : "delete_voice failed" }, true);
      }
    },
  );

  server.registerTool(
    "list_voices",
    {
      description: "List voices for a provider.",
      inputSchema: { provider_id: z.string().optional() },
    },
    async ({ provider_id }) => {
      try {
        return asText(await hub.listVoices(provider_id));
      } catch (err) {
        return asText({ error: err instanceof Error ? err.message : "list_voices failed" }, true);
      }
    },
  );

  return { server, hub };
}

async function main() {
  const { server } = await createHubMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("server.ts")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
