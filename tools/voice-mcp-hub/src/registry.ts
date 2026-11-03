import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type HubRegistry = {
  defaultProvider: string;
  enabled: string[];
};

export function loadRegistry(
  env: Record<string, string | undefined> = process.env,
  hubRoot = join(process.cwd(), "tools/voice-mcp-hub"),
): HubRegistry {
  const fromEnvDefault = (env.VOICE_HUB_DEFAULT_PROVIDER || "chatterbox-local").trim();
  const enabledRaw = (env.VOICE_HUB_ENABLED || "").trim();
  const path = env.VOICE_HUB_REGISTRY || join(hubRoot, "registry.json");
  let file: Partial<HubRegistry> = {};
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, "utf8")) as HubRegistry;
    } catch {
      file = {};
    }
  }
  const enabled =
    enabledRaw.length > 0
      ? enabledRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : Array.isArray(file.enabled) && file.enabled.length
        ? file.enabled
        : [
            "chatterbox-local",
            "cosyvoice3-local",
            "generic-http",
            "elevenlabs",
            "mcp-proxy",
            "mock",
            "xai",
          ];
  return {
    defaultProvider: (file.defaultProvider || fromEnvDefault).trim() || "chatterbox-local",
    enabled,
  };
}
