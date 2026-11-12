/**
 * Server-only owner key slots. Never log, print, or persist secret values.
 * The management key is for creating keys, usage, and team admin only.
 * It must never be sent to https://api.x.ai.
 */
import { existsSync, readFileSync } from "node:fs";

export const OWNER_VOICE_SECRET_PATHS = [
  "/home/ubuntu/.secrets/adrian-voice.env",
  "/home/box/.secrets/xai_voice.env",
] as const;

export type OwnerKeyId = "module" | "management" | "voice";

export type OwnerKeySlot = {
  id: OwnerKeyId;
  label: string;
  use: string;
  present: boolean;
  last4: string;
};

export type CopyOwnerKeyResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

const SLOT_META: ReadonlyArray<{ id: OwnerKeyId; label: string; use: string }> = [
  {
    id: "module",
    label: "Module",
    use: "Used for Direct and modules",
  },
  {
    id: "management",
    label: "Management",
    use: "Used only to create keys, usage, and team admin — never sent to https://api.x.ai",
  },
  {
    id: "voice",
    label: "Voice",
    use: "Voice",
  },
];

type EnvBag = Record<string, string | undefined>;

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function lastFour(value: string): string {
  return value.slice(-4);
}

function readNamedEnvFile(path: string, name: string): string | undefined {
  if (!existsSync(path)) return undefined;
  let body: string;
  try {
    body = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const pattern = new RegExp(`^(?:export\\s+)?${name}\\s*=\\s*(.*)$`);
  for (const line of body.split(/\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;
    const match = trimmedLine.match(pattern);
    if (!match) continue;
    let value = match[1] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const next = value.trim();
    if (next) return next;
  }
  return undefined;
}

function resolveModuleKey(env: EnvBag): string | undefined {
  return trimmed(env.XAI_API_KEY);
}

function resolveManagementKey(env: EnvBag): string | undefined {
  return trimmed(env.XAI_MANAGEMENT_KEY);
}

function resolveVoiceKey(env: EnvBag): string | undefined {
  const fromEnv = trimmed(env.XAI_VOICE_API_KEY);
  if (fromEnv) return fromEnv;
  for (const path of OWNER_VOICE_SECRET_PATHS) {
    const fromFile = readNamedEnvFile(path, "XAI_VOICE_API_KEY");
    if (fromFile) return fromFile;
  }
  return undefined;
}

function resolveOwnerKey(id: OwnerKeyId, env: EnvBag): string | undefined {
  if (id === "module") return resolveModuleKey(env);
  if (id === "management") return resolveManagementKey(env);
  return resolveVoiceKey(env);
}

function slotFor(id: OwnerKeyId, env: EnvBag): OwnerKeySlot {
  const meta = SLOT_META.find((slot) => slot.id === id)!;
  const value = resolveOwnerKey(id, env);
  return {
    id,
    label: meta.label,
    use: meta.use,
    present: Boolean(value),
    last4: value ? lastFour(value) : "",
  };
}

/** Presence and last four characters only. Never includes the secret value. */
export function listOwnerKeySlots(env: EnvBag = process.env): OwnerKeySlot[] {
  return SLOT_META.map((slot) => slotFor(slot.id, env));
}

function hostIsLocal(host: string): boolean {
  const value = host.trim().toLowerCase();
  return value.startsWith("127.0.0.1") || value.startsWith("localhost");
}

async function incomingRequestHost(): Promise<string | null> {
  try {
    const server = await import("@tanstack/react-start/server");
    if (typeof server.getRequest !== "function") return null;
    const request = server.getRequest();
    if (!request) return null;
    const header = request.headers?.get?.("host");
    if (typeof header === "string" && header.trim()) return header.trim();
    if (typeof request.url === "string" && request.url) {
      try {
        return new URL(request.url).host || null;
      } catch {
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Return one owner key for a local clipboard copy.
 * Refuses unless the incoming request host starts with 127.0.0.1 or localhost.
 * If getRequest is unavailable or throws, this refuses. Never logs the value.
 */
export async function copyOwnerKey(id: string, env: EnvBag = process.env): Promise<CopyOwnerKeyResult> {
  const host = await incomingRequestHost();
  if (!host || !hostIsLocal(host)) {
    return { ok: false, error: "Copy is only available on this machine." };
  }
  if (id !== "module" && id !== "management" && id !== "voice") {
    return { ok: false, error: "Unknown key." };
  }
  const value = resolveOwnerKey(id, env);
  if (!value) return { ok: false, error: "Key is missing." };
  return { ok: true, value };
}
