/**
 * Server-only voice key resolution. Never log or return the raw key to clients.
 */
import { existsSync, readFileSync } from "node:fs";

export const XAI_VOICE_SECRETS_PATH = "/home/box/.secrets/xai_voice.env";
const LOCAL_VOICE_SECRETS_PATH = "/home/ubuntu/.secrets/adrian-voice.env";

/** Read `XAI_VOICE_API_KEY=...` from the box secrets file. */
export function readVoiceSecretsFile(path: string = XAI_VOICE_SECRETS_PATH): string | undefined {
  if (!existsSync(path)) return undefined;
  const body = readFileSync(path, "utf8");
  for (const line of body.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?(?:XAI_VOICE_API_KEY|VOICE_API_KEY)=(.*)$/);
    if (!match) continue;
    let value = match[1]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value || undefined;
  }
  return undefined;
}

/**
 * Prefer process env, then box secrets file. Never prints the value.
 */
export function resolveVoiceApiKey(env: Record<string, string | undefined> = process.env, secretsPath: string = XAI_VOICE_SECRETS_PATH): string | undefined {
  const primary = env.XAI_VOICE_API_KEY?.trim();
  if (primary) return primary;
  const legacy = env.VOICE_API_KEY?.trim();
  if (legacy) return legacy;
  const fromFile = readVoiceSecretsFile(secretsPath);
  if (fromFile) {
    env.XAI_VOICE_API_KEY = fromFile;
    return fromFile;
  }
  if (secretsPath === XAI_VOICE_SECRETS_PATH) {
    const fromLocal = readVoiceSecretsFile(LOCAL_VOICE_SECRETS_PATH);
    if (fromLocal) {
      env.XAI_VOICE_API_KEY = fromLocal;
      return fromLocal;
    }
  }
  const chatKey = env.XAI_API_KEY?.trim();
  const management = env.XAI_MANAGEMENT_KEY?.trim();
  if (chatKey && chatKey !== management) return chatKey;
  return undefined;
}

export function voiceKeyConfigured(env: Record<string, string | undefined> = process.env, secretsPath?: string): boolean {
  return Boolean(resolveVoiceApiKey(env, secretsPath));
}
