import { existsSync, readFileSync } from "node:fs";

export const XAI_INFERENCE_SECRETS_PATH = "/home/box/.secrets/xai_inference.env";

/** Read XAI_API_KEY from the box secrets file. Never logs the value. */
export function readXaiInferenceSecretsFile(path: string = XAI_INFERENCE_SECRETS_PATH): string | undefined {
  if (!existsSync(path)) return undefined;
  const body = readFileSync(path, "utf8");
  for (const line of body.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?XAI_API_KEY=(.*)$/);
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
 * Prefer the box secrets file when present (avoids a stale/invalid process env key).
 * Falls back to env. Returns the key only — never mutates process.env / the env bag.
 */
export function resolveXaiInferenceApiKey(
  env: Record<string, string | undefined> = process.env,
  path: string = XAI_INFERENCE_SECRETS_PATH,
): string | undefined {
  const fromFile = readXaiInferenceSecretsFile(path);
  if (fromFile) return fromFile;
  const fromEnv = env.XAI_API_KEY?.trim();
  return fromEnv || undefined;
}
