import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  activeConversationIds,
  endUserIdFromHash,
  isConversationId,
  isNuanceKey,
  isSelectablePersona,
  mintNuanceSession,
  NUANCE_API_URL,
  publicPersonaRefusal,
  type MintResult,
  type NuancePersonaId,
} from "./nuance-live.ts";

export const NUANCE_SECRETS_PATH = process.env.NUANCE_SECRETS_PATH || "/home/ubuntu/.secrets/nuance_live.env";

const WORKTREE = "/tmp/adrian-visual-handoff";

export function isSafeSecretsPath(path: string): boolean {
  const absolute = resolve(path);
  if (absolute.startsWith(WORKTREE) || absolute.includes("/adrians-mind-command-os/")) return false;
  if (absolute.endsWith(".env") && absolute.includes("/.secrets/")) return true;
  return absolute === resolve(NUANCE_SECRETS_PATH);
}

export function readNuanceKey(path = NUANCE_SECRETS_PATH): string | null {
  if (!isSafeSecretsPath(path)) return null;
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    const match = /^NUANCE_API_KEY=(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1]?.trim() ?? "";
    return isNuanceKey(key) ? key : null;
  }
  return null;
}

export function saveNuanceKey(key: string, path = NUANCE_SECRETS_PATH): { ok: true } | { ok: false; error: string } {
  if (!isNuanceKey(key)) return { ok: false, error: "That is not a Nuance key. Nothing was saved." };
  if (!isSafeSecretsPath(path)) return { ok: false, error: "This host cannot store the key." };
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `NUANCE_API_KEY=${key}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
  } catch {
    return { ok: false, error: "This host cannot store the key." };
  }
  return { ok: true };
}

export function ownerEndUserId(userId: string): string {
  const hex = createHash("sha256").update(userId).digest("hex");
  return endUserIdFromHash(hex);
}

export async function mintSavedNuanceSession(userId: string, camera: boolean): Promise<MintResult> {
  const key = readNuanceKey();
  if (!key) return { ok: false, error: "A Nuance key is not saved on this computer.", status: 409 };
  return mintNuanceSession({ key, endUserId: ownerEndUserId(userId), camera });
}

async function nuanceGet(path: string, key: string): Promise<{ ok: true; text: string } | { ok: false; error: string; status: number }> {
  try {
    const response = await fetch(`${NUANCE_API_URL}${path}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, error: "The video call could not be checked. Nothing was started.", status: response.status };
    }
    return { ok: true, text };
  } catch {
    return { ok: false, error: "Nuance could not be reached. Nothing was started.", status: 502 };
  }
}

export async function listSavedActiveConversations(): Promise<{ ok: true; ids: string[] } | { ok: false; error: string; status: number }> {
  const key = readNuanceKey();
  if (!key) return { ok: false, error: "A Nuance key is not saved on this computer.", status: 409 };
  const listed = await nuanceGet("/conversations/active", key);
  if (!listed.ok) return listed;
  return { ok: true, ids: activeConversationIds(listed.text) };
}

export async function readSavedNuanceUsage(): Promise<{ ok: true; available: number; active: number } | { ok: false; error: string; status: number }> {
  const key = readNuanceKey();
  if (!key) return { ok: false, error: "A Nuance key is not saved on this computer.", status: 409 };
  const usage = await nuanceGet("/usage", key);
  if (!usage.ok) return usage;
  try {
    const parsed = JSON.parse(usage.text) as { available_credits?: unknown; active_sessions?: unknown };
    const available = typeof parsed.available_credits === "number" ? parsed.available_credits : 0;
    const active = typeof parsed.active_sessions === "number" ? parsed.active_sessions : 0;
    return { ok: true, available, active };
  } catch {
    return { ok: false, error: "The video call could not be checked. Nothing was started.", status: 502 };
  }
}

export async function endSavedConversation(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isConversationId(id)) return { ok: false, error: "That call could not be ended." };
  const key = readNuanceKey();
  if (!key) return { ok: false, error: "A Nuance key is not saved on this computer." };
  try {
    const response = await fetch(`${NUANCE_API_URL}/conversation/${id}/end`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-length": "0" },
    });
    if (!response.ok && response.status !== 404) return { ok: false, error: "The video call could not be ended." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Nuance could not be reached. The call was not ended." };
  }
}

export async function mintSavedNuanceSessionForPersona(
  userId: string,
  camera: boolean,
  personaId: string,
): Promise<MintResult> {
  if (!isSelectablePersona(personaId)) {
    return { ok: false, error: publicPersonaRefusal(personaId), status: 400 };
  }
  const key = readNuanceKey();
  if (!key) return { ok: false, error: "A Nuance key is not saved on this computer.", status: 409 };
  const active = await listSavedActiveConversations();
  if (!active.ok) return { ok: false, error: active.error, status: active.status };
  if (active.ids.length > 0) {
    return { ok: false, error: "A video call is already open. Nothing new was started.", status: 409 };
  }
  const usage = await readSavedNuanceUsage();
  if (!usage.ok) return { ok: false, error: usage.error, status: usage.status };
  if (usage.active > 0) {
    return { ok: false, error: "A video call is already open. Nothing new was started.", status: 409 };
  }
  if (usage.available <= 0) {
    return { ok: false, error: "Nuance credits are used up for today. Nothing was started.", status: 429 };
  }
  return mintNuanceSession({
    key,
    endUserId: ownerEndUserId(userId),
    camera,
    personaId,
  });
}
