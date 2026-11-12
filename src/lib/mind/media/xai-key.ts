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

const IMAGE_KEY_PATHS = ["/home/ubuntu/.secrets/adrian-image.env", "/home/box/.secrets/xai_image.env"] as const;
const VIDEO_KEY_PATHS = ["/home/ubuntu/.secrets/adrian-video.env", "/home/box/.secrets/xai_video.env"] as const;

function readNamedEnv(path: string, name: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const body = readFileSync(path, "utf8");
  const pattern = new RegExp("^(?:export\\s+)?" + name + "\\s*=\\s*(.*)$");
  for (const line of body.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(pattern);
    if (!match) continue;
    let value = (match[1] ?? "").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value.trim()) return value.trim();
  }
  return undefined;
}

function readFirstNamed(paths: readonly string[], name: string): string | undefined {
  for (const path of paths) {
    const found = readNamedEnv(path, name);
    if (found) return found;
  }
  return undefined;
}

/** Image generation key. Falls back to the module key only when no image key is saved. */
export function resolveImageApiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.XAI_IMAGE_API_KEY?.trim() || readFirstNamed(IMAGE_KEY_PATHS, "XAI_IMAGE_API_KEY") || resolveXaiInferenceApiKey(env);
}

/** Video generation key. Falls back to the module key only when no video key is saved. */
export function resolveVideoApiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.XAI_VIDEO_API_KEY?.trim() || readFirstNamed(VIDEO_KEY_PATHS, "XAI_VIDEO_API_KEY") || resolveXaiInferenceApiKey(env);
}
