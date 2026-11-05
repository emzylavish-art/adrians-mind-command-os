import type { MicPermissionState, SessionReason } from "./events.ts";

export const SPEAK_SESSION_STORAGE_KEY = "amcos.speak.session.v1";

export type SpeakSessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SpeakSessionSnapshot = {
  version: 1;
  session_id: string;
  prev_session_id?: string;
  permission: MicPermissionState | null;
  device_id: string | null;
  open: boolean;
  resume_eligible: boolean;
  reason: SessionReason;
  updated_at_ms: number;
};

const REASONS: readonly SessionReason[] = [
  "speak_button",
  "user",
  "reload",
  "reconnect",
  "permission_revoked",
  "device_change",
  "error",
  "esc",
];

export function createMemoryStorage(): SpeakSessionStorage {
  const map = new Map<string, string>();
  return {
    getItem(key) {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function isReason(value: unknown): value is SessionReason {
  return typeof value === "string" && (REASONS as readonly string[]).includes(value);
}

function isPermission(value: unknown): value is MicPermissionState {
  return value === "granted" || value === "denied" || value === "prompt";
}

export function readSpeakSession(
  storage: SpeakSessionStorage | null | undefined,
): SpeakSessionSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SPEAK_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SpeakSessionSnapshot>;
    if (parsed.version !== 1 || typeof parsed.session_id !== "string" || !parsed.session_id) {
      return null;
    }
    return {
      version: 1,
      session_id: parsed.session_id,
      prev_session_id:
        typeof parsed.prev_session_id === "string" ? parsed.prev_session_id : undefined,
      permission: isPermission(parsed.permission) ? parsed.permission : null,
      device_id: typeof parsed.device_id === "string" && parsed.device_id ? parsed.device_id : null,
      open: Boolean(parsed.open),
      resume_eligible: Boolean(parsed.resume_eligible),
      reason: isReason(parsed.reason) ? parsed.reason : "user",
      updated_at_ms: typeof parsed.updated_at_ms === "number" ? parsed.updated_at_ms : 0,
    };
  } catch {
    return null;
  }
}

export function writeSpeakSession(
  storage: SpeakSessionStorage | null | undefined,
  snapshot: SpeakSessionSnapshot,
): void {
  if (!storage) return;
  try {
    storage.setItem(SPEAK_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* private mode or quota — continuity degrades to this page load */
  }
}

export function resumeEligibleFor(reason: SessionReason): boolean {
  return (
    reason === "permission_revoked" ||
    reason === "device_change" ||
    reason === "error" ||
    reason === "reload" ||
    reason === "reconnect"
  );
}
