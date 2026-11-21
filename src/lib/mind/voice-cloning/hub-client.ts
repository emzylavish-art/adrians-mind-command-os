/**
 * Studio → Voice Connection Hub client.
 * Default: in-process hub (same Node). Optional: VOICE_HUB_URL streamable HTTP later.
 */
import { join } from "node:path";
import { createVoiceHub, type VoiceHub } from "../../../../tools/voice-mcp-hub/src/hub.ts";
import { issueConsentToken, verifyConsentToken } from "../../../../tools/voice-mcp-hub/src/consent-token.ts";

let cached: VoiceHub | null = null;

export async function getStudioVoiceHub(
  env: Record<string, string | undefined> = process.env,
): Promise<VoiceHub> {
  if (env.VOICE_HUB_URL?.trim()) {
    // HTTP MCP client path reserved — in-process is the supported default for this drop.
    // When VOICE_HUB_URL is set but unreachable, callers surface hub-down.
  }
  if (!cached) {
    cached = await createVoiceHub({
      env,
      hubRoot: join(process.cwd(), "tools/voice-mcp-hub"),
      adaptersDir: join(process.cwd(), "tools/voice-mcp-hub/adapters"),
    });
  }
  return cached;
}

export function resetStudioVoiceHubForTests(): void {
  cached = null;
}

export { issueConsentToken, verifyConsentToken };
