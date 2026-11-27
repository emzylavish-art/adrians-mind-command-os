import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Sql } from "../db.ts";
import { resolveDatabaseUrl } from "../env.server.ts";
import { connectorTokenSecretStatus, decryptSecret, encryptSecret } from "./connectors/crypto.ts";
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
const NUANCE_CONNECTOR = "nuance";

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

export type NuanceKeyStoreDependencies = {
  sql?: Sql;
  env?: NodeJS.ProcessEnv;
  secret?: string;
  filePath?: string;
};

async function nuanceSql(deps: NuanceKeyStoreDependencies): Promise<Sql> {
  return deps.sql ?? (await import("../db.ts")).getSql();
}

function hasDurableNuanceStore(deps: NuanceKeyStoreDependencies): boolean {
  return Boolean(deps.sql || resolveDatabaseUrl(deps.env ?? process.env));
}

/** Hosted callers may use only the key saved by their own account. */
export async function readOwnerNuanceKey(userId: string, deps: NuanceKeyStoreDependencies = {}): Promise<string | null> {
  if (!userId) return null;
  if (hasDurableNuanceStore(deps)) {
    try {
      const rows = await (await nuanceSql(deps)).query<{ access_token_enc: string }>(
        "select access_token_enc from mind_oauth_connections where owner_id=$1 and connector=$2",
        [userId, NUANCE_CONNECTOR],
      );
      const saved = rows[0]?.access_token_enc ? decryptSecret(rows[0].access_token_enc, deps.secret) : null;
      if (saved && isNuanceKey(saved)) return saved;
    } catch {
      return null;
    }
  } else if (userId === "dev-user" && !(deps.env ?? process.env).VERCEL) {
    const local = readNuanceKey(deps.filePath ?? NUANCE_SECRETS_PATH);
    if (local) return local;
  }
  return null;
}

/** Persist a Nuance key durably and encrypted for exactly one signed-in owner. */
export async function saveOwnerNuanceKey(
  userId: string,
  key: string,
  deps: NuanceKeyStoreDependencies = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!userId) return { ok: false, error: "Sign in is required. Nothing was saved." };
  if (!isNuanceKey(key)) return { ok: false, error: "That is not a Nuance key. Nothing was saved." };
  if (!hasDurableNuanceStore(deps)) {
    if (userId === "dev-user" && !(deps.env ?? process.env).VERCEL) return saveNuanceKey(key, deps.filePath ?? NUANCE_SECRETS_PATH);
    return { ok: false, error: "Account credential storage is unavailable. Nothing was saved." };
  }
  const secret = connectorTokenSecretStatus(deps.secret);
  if (!secret.ok) return { ok: false, error: "Credential encryption is not configured. Nothing was saved." };
  try {
    const encrypted = encryptSecret(key, secret.secret).ciphertext;
    await (await nuanceSql(deps)).query(
      `insert into mind_oauth_connections
       (owner_id,connector,access_token_enc,connected_at,token_type,scopes)
       values($1,$2,$3,now(),'api_key','video_call')
       on conflict(owner_id,connector) do update set
       access_token_enc=excluded.access_token_enc,connected_at=excluded.connected_at,
       token_type=excluded.token_type,scopes=excluded.scopes`,
      [userId, NUANCE_CONNECTOR, encrypted],
    );
    const confirmed = await readOwnerNuanceKey(userId, deps);
    return confirmed === key
      ? { ok: true }
      : { ok: false, error: "The key could not be confirmed after saving. Nothing was started." };
  } catch {
    return { ok: false, error: "The encrypted key could not be saved for this account." };
  }
}

export function ownerEndUserId(userId: string): string {
  const hex = createHash("sha256").update(userId).digest("hex");
  return endUserIdFromHash(hex);
}

export async function mintSavedNuanceSession(userId: string, camera: boolean): Promise<MintResult> {
  const key = await readOwnerNuanceKey(userId);
  if (!key) return { ok: false, error: "A Nuance key is not saved for this account.", status: 409 };
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

export async function listSavedActiveConversations(userId: string): Promise<{ ok: true; ids: string[] } | { ok: false; error: string; status: number }> {
  const key = await readOwnerNuanceKey(userId);
  if (!key) return { ok: false, error: "A Nuance key is not saved for this account.", status: 409 };
  const listed = await nuanceGet("/conversations/active", key);
  if (!listed.ok) return listed;
  return { ok: true, ids: activeConversationIds(listed.text) };
}

export async function readSavedNuanceUsage(userId: string): Promise<{ ok: true; available: number; active: number } | { ok: false; error: string; status: number }> {
  const key = await readOwnerNuanceKey(userId);
  if (!key) return { ok: false, error: "A Nuance key is not saved for this account.", status: 409 };
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

export async function endSavedConversation(userId: string, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isConversationId(id)) return { ok: false, error: "That call could not be ended." };
  const key = await readOwnerNuanceKey(userId);
  if (!key) return { ok: false, error: "A Nuance key is not saved for this account." };
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
  const key = await readOwnerNuanceKey(userId);
  if (!key) return { ok: false, error: "A Nuance key is not saved for this account.", status: 409 };
  const active = await listSavedActiveConversations(userId);
  if (!active.ok) return { ok: false, error: active.error, status: active.status };
  if (active.ids.length > 0) {
    return { ok: false, error: "A video call is already open. Nothing new was started.", status: 409 };
  }
  const usage = await readSavedNuanceUsage(userId);
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
