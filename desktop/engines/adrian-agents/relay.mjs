import { compareAndSet, freshOwnership, heartbeat, missed, renewLease, telegramNotice, watchdog } from "./failover.mjs";

export function readRelayEnv(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const allowed = env.ADRIAN_TELEGRAM_USER_ID || "";
  if (!url || !key) return { refused: "Supabase is not configured. Outbound stays stopped." };
  return { url: url.replace(/\/$/, ""), key, allowed };
}

const readFailure = { refused: "The ownership row could not be read. Stop outbound." };
const writeFailure = { refused: "The ownership change was not confirmed. Stop outbound." };

function fromStorage(row) {
  if (row?.id !== 1 || !["pc", "phone"].includes(row.owner) ||
      !Number.isSafeInteger(row.epoch) || !Number.isSafeInteger(row.lease_expires) ||
      !Number.isSafeInteger(row.flap_until) || typeof row.paused !== "boolean" ||
      typeof row.going_down !== "boolean") return null;
  return {
    id: row.id, owner: row.owner, epoch: row.epoch, lease_expires: row.lease_expires,
    flapUntil: row.flap_until, paused: row.paused, goingDown: row.going_down,
  };
}

export async function readOwnership(fetchImpl, env) {
  const gate = readRelayEnv(env);
  if (gate.refused) return gate;
  try {
    const response = await fetchImpl(`${gate.url}/rest/v1/mind_failover_ownership?id=eq.1&select=*`, {
      headers: { apikey: gate.key, Authorization: `Bearer ${gate.key}` },
    });
    if (!response.ok) return readFailure;
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length > 1) return readFailure;
    return rows.length ? fromStorage(rows[0]) ?? readFailure : null;
  } catch {
    return readFailure;
  }
}

async function persistOwnership(fetchImpl, gate, current, expectedEpoch, next, now) {
  const row = current ?? freshOwnership(now);
  const updated = compareAndSet(row, expectedEpoch ?? row.epoch, next, now);
  if (updated.refused) return updated;
  const stored = {
    owner: updated.owner, epoch: updated.epoch, lease_expires: updated.lease_expires,
    flap_until: updated.flapUntil, paused: updated.paused, going_down: updated.goingDown ?? false,
  };
  // Existing rows are fenced in the mutation itself. Bootstrap competes on the primary key.
  const predicate = current ? `?id=eq.1&epoch=eq.${current.epoch}&owner=eq.${current.owner}` : "";
  try {
    const response = await fetchImpl(`${gate.url}/rest/v1/mind_failover_ownership${predicate}`, {
      method: current ? "PATCH" : "POST",
      headers: {
        apikey: gate.key, Authorization: `Bearer ${gate.key}`,
        "Content-Type": "application/json", Prefer: "return=representation",
      },
      body: JSON.stringify(current ? stored : { id: 1, ...stored }),
    });
    if (!response.ok) return writeFailure;
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1) return writeFailure;
    const confirmed = fromStorage(rows[0]);
    if (!confirmed || Object.entries(stored).some(([key, value]) => rows[0][key] !== value)) return writeFailure;
    return confirmed;
  } catch {
    return writeFailure;
  }
}

export async function writeOwnership(fetchImpl, env, expectedEpoch, next, now) {
  const current = await readOwnership(fetchImpl, env);
  if (current?.refused) return current;
  return persistOwnership(fetchImpl, readRelayEnv(env), current, expectedEpoch, next, now);
}

export async function pcBeat(fetchImpl, env, now, serverNow, health, goingDown = false) {
  const gate = readRelayEnv(env);
  if (gate.refused) return { stopped: true, ...gate };
  const beat = heartbeat("pc", now, serverNow, health, goingDown);
  const current = await readOwnership(fetchImpl, env);
  if (current && current.refused) return { stopped: true, ...current };
  const row = current || freshOwnership(now);
  if (missed(now, row.lease_expires - 60000) && now > row.lease_expires) {
    return { stopped: true, refused: "Lease expired. Stop outbound.", beat };
  }
  const renewed = renewLease(row, "pc", now);
  if (renewed.stopped) return { ...renewed, beat };
  const written = await persistOwnership(fetchImpl, gate, current, row.epoch, { owner: "pc", lease_expires: now + 60000, goingDown }, now);
  if (written.refused) return { stopped: true, ...written, beat };
  return { stopped: false, beat, row: written };
}

export function humanNotice(env, userId, text) {
  const gate = readRelayEnv(env);
  return telegramNotice(userId, gate.allowed, text);
}

export function runWatchdog(row, now, pcLast, phoneLast) {
  return watchdog(row, now, pcLast, phoneLast);
}
