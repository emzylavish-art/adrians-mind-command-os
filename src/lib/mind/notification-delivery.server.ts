import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { decryptSecret, encryptSecret } from "./connectors/crypto.ts";
import { deliveryAllowed, deliveryPreferences, notificationDeviceId, type DeliveryChannel, type DeliveryPreferences, type NotificationStatus } from "./notification-delivery.ts";
import { parseDeviceSubscription, type DeliveryOutcome, type NotificationTransports } from "./notification-transports.server.ts";
import { workspaceNotices, type WorkspaceNotice } from "./notifications.ts";
import { readSnapshot } from "./store.ts";
import { normalizeWorkspace } from "./workspace.ts";

type Target = {
  id: string; user_id: string; channel: DeliveryChannel; device_id: string | null;
  destination: unknown; preferences: unknown; enabled_at: string;
};
type VerifiedAddress = { email: string };
const DAY_MS = 86_400_000;
const validHash = (value: string) => /^[0-9a-f]{64}$/.test(value);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const result = (status: number, body: Record<string, unknown>) => ({ status, body });
const problem = (status: number, error: string) => result(status, { error });

async function verifiedAddress(sql: Sql, owner: string) {
  const [account] = await sql.query<VerifiedAddress>('select email from "user" where id=$1 and "emailVerified"=true', [owner]);
  return account?.email ?? null;
}

function storedBrowserSubscription(value: unknown, push: NonNullable<NotificationTransports["push"]>) {
  if (!value || typeof value !== "object" || !("sealed" in value)) return parseDeviceSubscription(value);
  if (typeof value.sealed !== "string" || !("key" in value) || value.key !== push.publicKey) return null;
  const text = decryptSecret(value.sealed, push.storageSecret);
  try { return text ? parseDeviceSubscription(JSON.parse(text)) : null; } catch { return null; }
}

export async function notificationStatus(sql: Sql, owner: string, device: string | null, transports: NotificationTransports, workerConfigured: boolean): Promise<NotificationStatus> {
  type StatusRow = Pick<Target, "channel" | "destination"> & {
    last_checked: string | null; attempted_at: string | null;
    state: NonNullable<NotificationStatus["push"]["lastAttempt"]>["state"] | null;
  };
  const rows = await sql.query<StatusRow>(`select t.channel,t.destination,t.last_checked::text,d.state,d.attempted_at::text
    from mind_notification_target t
    left join lateral (
      select state,attempted_at from mind_notification_delivery where target_id=t.id order by attempted_at desc limit 1
    ) d on true
    where t.user_id=$1 and (t.channel='email' or t.device_id=$2)`, [owner, device]);
  const email = await verifiedAddress(sql, owner);
  const describe = (row?: StatusRow) => ({
    subscribed: Boolean(row), lastChecked: row?.last_checked ?? undefined,
    lastAttempt: row?.state && row.attempted_at ? { state: row.state, at: row.attempted_at } : undefined,
  });
  return {
    push: { available: Boolean(transports.push), ...describe(rows.find(row => row.channel === "push")), publicKey: transports.push?.publicKey },
    email: { available: Boolean(transports.email && email), ...describe(rows.find(row => row.channel === "email" && (row.destination === email || !email))), address: email ?? undefined },
    workerConfigured,
  };
}

export async function updateNotificationDelivery(sql: Sql, owner: string, body: Record<string, unknown>, transports: NotificationTransports) {
  const { action, channel, device } = body;
  if (device != null && !notificationDeviceId(device)) return problem(400, "Invalid browser registration.");
  if (action === "preferences") {
    const prefs = deliveryPreferences(body.preferences);
    if (!prefs) return problem(400, "Choose valid event types and quiet hours.");
    await sql.query("update mind_notification_target set preferences=$3::jsonb where user_id=$1 and (channel='email' or device_id=$2)", [owner, device ?? null, JSON.stringify(prefs)]);
    return result(200, { saved: true });
  }
  if (channel !== "push" && channel !== "email") return problem(400, "Choose a delivery method.");
  if (channel === "push" && !device) return problem(400, "This browser is missing a registration.");
  if (action === "disable") {
    await sql.query("delete from mind_notification_target where user_id=$1 and channel=$2 and device_id is not distinct from $3::uuid", [owner, channel, deviceFor(channel, device)]);
    return result(200, { saved: true });
  }
  if (action !== "enable") return problem(400, "Choose a notification action.");
  const prefs = deliveryPreferences(body.preferences);
  if (!prefs) return problem(400, "Choose valid event types and quiet hours.");
  if (!transports[channel] || !sql.transaction) return problem(503, "This delivery method is unavailable.");
  const subscription = channel === "push" ? parseDeviceSubscription(body.subscription) : null;
  if (channel === "push" && !subscription) return problem(400, "This browser push subscription is unsupported or invalid.");

  return sql.transaction(async tx => {
    const [account] = await tx.query<{ email: string; emailVerified: boolean }>('select email,"emailVerified" from "user" where id=$1 for update', [owner]);
    if (!account) return problem(409, "This signed-in account has no delivery profile.");
    if (channel === "email" && !account.emailVerified) return problem(409, "Verify your account email first.");
    const endpoint = subscription ? digest(subscription.endpoint) : null;
    const push = transports.push;
    const destination = subscription && push
      ? { sealed: encryptSecret(JSON.stringify(subscription), push.storageSecret).ciphertext, key: push.publicKey }
      : account.email;
    const [present] = await tx.query<{ id: string; destination: unknown }>(
      "select id,destination from mind_notification_target where user_id=$1 and channel=$2 and device_id is not distinct from $3::uuid",
      [owner, channel, deviceFor(channel, device)],
    );
    const same = present && (subscription && push
      ? JSON.stringify(storedBrowserSubscription(present.destination, push)) === JSON.stringify(subscription)
      : present.destination === account.email);
    if (same) {
      await tx.query("update mind_notification_target set preferences=$2::jsonb,destination=$3::jsonb,endpoint=$4 where id=$1",
        [present.id, JSON.stringify(prefs), JSON.stringify(destination), endpoint]);
      return result(200, { saved: true });
    }
    if (endpoint) {
      const [collision] = await tx.query("select id from mind_notification_target where endpoint in ($1,$2)", [endpoint, subscription?.endpoint]);
      if (collision && collision.id !== present?.id) return problem(409, "This browser subscription is already registered.");
    }
    if (!present && channel === "push") {
      const [count] = await tx.query<{ count: number | string }>("select count(*) from mind_notification_target where user_id=$1 and channel='push'", [owner]);
      if (Number(count?.count) >= 8) return problem(409, "This account already has eight registered browsers.");
    }
    if (present) await tx.query("delete from mind_notification_target where id=$1", [present.id]);
    await tx.query("insert into mind_notification_target(id,user_id,channel,device_id,endpoint,destination,preferences) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)",
      [randomUUID(), owner, channel, deviceFor(channel, device), endpoint, JSON.stringify(destination), JSON.stringify(prefs)]);
    return result(200, { saved: true });
  });
}

function deviceFor(channel: DeliveryChannel, device: unknown) {
  return channel === "push" ? device : null;
}

export async function mayDisplayScheduledPush(sql: Sql, owner: string, device: string, hash: string, now = new Date()) {
  if (!notificationDeviceId(device) || !validHash(hash)) return false;
  const [row] = await sql.query<{ preferences: unknown; urgent: boolean }>(`select t.preferences,d.urgent
    from mind_notification_target t join mind_notification_delivery d on d.target_id=t.id
    where t.user_id=$1 and t.channel='push' and t.device_id=$2 and d.event_hash=$3
      and not exists (select 1 from mind_control where user_id=t.user_id and halted)
      and d.state in ('attempted','accepted','unknown') and d.attempted_at >= $4`, [owner, device, hash, new Date(now.getTime() - 310_000).toISOString()]);
  const prefs = deliveryPreferences(row?.preferences);
  return Boolean(row && prefs && deliveryAllowed(row, prefs, now));
}

async function targetNotices(sql: Sql, owner: string, prefs: DeliveryPreferences) {
  const snapshot = await readSnapshot(sql, owner);
  const workspace = normalizeWorkspace(snapshot);
  if (workspace.halted) return [];
  const reports = prefs.research === true ? await sql.query<{ id: string; version: number; question: string; at: string }>(
    "select report_id as id,revision as version,question,updated_at::text as at from mind_research_report where owner_id=$1 and archived=false order by updated_at desc limit 30", [owner],
  ) : [];
  return workspaceNotices(workspace, prefs, reports);
}

async function finishNotificationClaim(sql: Sql, target: Target, event: WorkspaceNotice, hash: string, at: Date,
  prefs: DeliveryPreferences, transports: NotificationTransports): Promise<Exclude<DeliveryOutcome, "expired">> {
  return sql.transaction!(async tx => {
    // The earlier transaction committed the one-attempt receipt. Keep the
    // live account, stop and consent locked through the bounded provider call.
    const [account] = await tx.query<{ email: string; emailVerified: boolean }>('select email,"emailVerified" from "user" where id=$1 for share', [target.user_id]);
    const [control] = await tx.query<{ halted: boolean }>("select halted from mind_control where user_id=$1 for share", [target.user_id]);
    const [current] = await tx.query<Pick<Target, "destination" | "device_id">>(
      "select destination,device_id from mind_notification_target where id=$1 and user_id=$2 and channel=$3 and preferences=$4::jsonb for update",
      [target.id, target.user_id, target.channel, JSON.stringify(prefs)],
    );
    let outcome: DeliveryOutcome = "rejected";
    if (account && control?.halted === false && current && deliveryAllowed(event, prefs, at)) {
      try {
        if (target.channel === "email" && transports.email && account.emailVerified && current.destination === account.email) {
          outcome = await transports.email.send(account.email, `adrian-${target.id}-${hash}`);
        } else if (target.channel === "push" && transports.push && current.device_id) {
          const subscription = storedBrowserSubscription(current.destination, transports.push);
          if (subscription) outcome = await transports.push.send(subscription, current.device_id, hash);
        }
      } catch { outcome = "unknown"; }
    }
    if (outcome === "expired") {
      await tx.query("delete from mind_notification_target where id=$1 and user_id=$2", [target.id, target.user_id]);
      return "rejected";
    }
    await tx.query("update mind_notification_delivery set state=$3 where target_id=$1 and event_hash=$2 and state='attempted'", [target.id, hash, outcome]);
    return outcome;
  });
}

/** Each committed ledger row permits one external attempt. Ambiguous outcomes stay recorded. */
export async function runNotificationPass(sql: Sql, transports: NotificationTransports, now = new Date()) {
  const counts = { checked: 0, accepted: 0, rejected: 0, unknown: 0 };
  if (!transports.push && !transports.email) return counts;
  const started = Date.now();
  const targets = await sql.query<Target>(`with selected as (
    select id from mind_notification_target where (channel='push' and $1) or (channel='email' and $2)
    order by last_checked nulls first,id limit 4 for update skip locked
  ) update mind_notification_target t set last_checked=$3 from selected where t.id=selected.id
    returning t.id,t.user_id,t.channel,t.device_id,t.destination,t.preferences,t.enabled_at::text`,
    [Boolean(transports.push), Boolean(transports.email), now.toISOString()]);
  for (const target of targets) {
    counts.checked++;
    const prefs = deliveryPreferences(target.preferences);
    if (!prefs) continue;
    const recent = await targetNotices(sql, target.user_id, prefs);
    const floor = Math.max(Date.parse(target.enabled_at), now.getTime() - DAY_MS);
    const candidates = recent.filter(notice => {
      const at = Date.parse(notice.at);
      return at > floor && at <= now.getTime() && deliveryAllowed(notice, prefs, now);
    }).slice(0, 48).map(notice => ({ notice, hash: digest(notice.id) }));
    if (!candidates.length) continue;
    const covered = new Set((await sql.query<{ event_hash: string }>(
      "select event_hash from mind_notification_delivery where target_id=$1 and event_hash=any($2::text[])",
      [target.id, candidates.map(candidate => candidate.hash)],
    )).map(row => row.event_hash));
    for (const { notice, hash } of candidates) {
      if (covered.has(hash)) continue;
      // Serialize consent and preference changes with the claim, before contacting a provider.
      if (!sql.transaction) throw new Error("Atomic notification storage is unavailable.");
      const [claim] = await sql.transaction(async tx => {
        const [account] = await tx.query<{ email: string; emailVerified: boolean }>('select email,"emailVerified" from "user" where id=$1 for update', [target.user_id]);
        if (!account || (target.channel === "email" && (!account.emailVerified || account.email !== target.destination))) return [];
        await tx.query("insert into mind_control(user_id,halted) values($1,false) on conflict do nothing", [target.user_id]);
        const [control] = await tx.query<{ halted: boolean }>("select halted from mind_control where user_id=$1 for update", [target.user_id]);
        if (control?.halted !== false) return [];
        const [current] = await tx.query<{ id: string }>(`select id from mind_notification_target where id=$1 and preferences=$2::jsonb for update`,
          [target.id, JSON.stringify(target.preferences)]);
        return current ? tx.query<{ target_id: string }>(`insert into mind_notification_delivery(target_id,event_hash,urgent,state,attempted_at)
          values($1,$2,$3,'attempted',$4) on conflict do nothing returning target_id`, [target.id, hash, notice.urgent, now.toISOString()]) : [];
      });
      if (!claim) continue;
      try {
        const at = new Date(now.getTime() + Math.max(0, Date.now() - started));
        const outcome = await finishNotificationClaim(sql, target, notice, hash, at, prefs, transports);
        counts[outcome]++;
      } catch { counts.unknown++; }
      break;
    }
  }
  await sql.query(`delete from mind_notification_delivery where (target_id,event_hash) in (
    select target_id,event_hash from mind_notification_delivery where attempted_at<$1
    order by attempted_at limit 100)`, [new Date(now.getTime() - 2 * DAY_MS).toISOString()]);
  return counts;
}
