import { compareAndSet, freshOwnership, heartbeat, missed, renewLease, telegramNotice, watchdog } from "./failover.mjs";

export function readRelayEnv(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const allowed = env.ADRIAN_TELEGRAM_USER_ID || "";
  if (!url || !key) return { refused: "Supabase is not configured. Outbound stays stopped." };
  return { url: url.replace(/\/$/, ""), key, allowed };
}

export async function readOwnership(fetchImpl, env) {
  const gate = readRelayEnv(env);
  if (gate.refused) return gate;
  const response = await fetchImpl(`${gate.url}/rest/v1/mind_failover_ownership?id=eq.1&select=*`, {
    headers: { apikey: gate.key, Authorization: `Bearer ${gate.key}` },
  });
  if (!response.ok) return { refused: "The ownership row could not be read. Stop outbound." };
  const rows = await response.json();
  return rows[0] || null;
}

export async function writeOwnership(fetchImpl, env, expectedEpoch, next, now) {
  const current = await readOwnership(fetchImpl, env);
  if (current && current.refused) return current;
  const row = current || freshOwnership(now);
  const updated = compareAndSet(row, expectedEpoch ?? row.epoch, next, now);
  if (updated.refused) return updated;
  const gate = readRelayEnv(env);
  const response = await fetchImpl(`${gate.url}/rest/v1/mind_failover_ownership?id=eq.1`, {
    method: "POST",
    headers: {
      apikey: gate.key,
      Authorization: `Bearer ${gate.key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ id: 1, ...updated }),
  });
  if (!response.ok) return { refused: "The ownership row was not written. Stop outbound." };
  return updated;
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
  const written = await writeOwnership(fetchImpl, env, row.epoch, { owner: "pc", lease_expires: now + 60000, goingDown }, now);
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
