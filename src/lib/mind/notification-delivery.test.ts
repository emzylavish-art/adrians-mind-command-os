import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import webPush from "web-push";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { deliveryAllowed, deliveryPreferences } from "./notification-delivery.ts";
import { mayDisplayScheduledPush, notificationStatus, runNotificationPass, updateNotificationDelivery } from "./notification-delivery.server.ts";
import { notificationTransports, parseDeviceSubscription, type NotificationTransports } from "./notification-transports.server.ts";
import { notificationKey } from "./notification-marks.ts";
import { listNotificationMarks, saveNotificationMarks } from "./notification-marks.server.ts";
import { emptyWorkspace } from "./workspace.ts";

const settings = { completedRuns: true, activity: true, research: false, media: false, quietStart: null, quietEnd: null, zone: "UTC" };
const recipient = "owner@example.invalid";
function deviceSubscription() {
  const ecdh = createECDH("prime256v1");
  return { endpoint: "https://fcm.googleapis.com/fcm/send/fixture", keys: { auth: randomBytes(16).toString("base64url"), p256dh: ecdh.generateKeys().toString("base64url") } };
}

function sqlAdapter(db: PGlite | Transaction): Sql {
  const query: Sql["query"] = async function <T>(text: string, params?: unknown[]) { return (await db.query<T>(text, params)).rows; };
  const sql = (async <T>(strings: TemplateStringsArray, ...params: unknown[]) =>
    query<T>(strings.reduce((text, part, i) => text + (i ? "$" + i : "") + part, ""), params)) as Sql;
  sql.query = query;
  if (db instanceof PGlite) sql.transaction = fn => db.transaction(tx => fn(sqlAdapter(tx)));
  return sql;
}

test("validates background zones, quiet hours and approved browser endpoints", () => {
  const quiet = deliveryPreferences({ ...settings, zone: "America/New_York", quietStart: 22, quietEnd: 7 })!;
  const duringQuiet = new Date("2026-11-28T05:00:00Z");
  assert.equal(deliveryAllowed({ urgent: false }, quiet, duringQuiet), false);
  assert.equal(deliveryAllowed({ urgent: true }, quiet, duringQuiet), true);
  assert.equal(deliveryAllowed({ urgent: true }, { ...quiet, urgent: false }, duringQuiet), false);
  assert.equal(deliveryAllowed({ urgent: false }, quiet, new Date("2026-11-28T12:00:00Z")), true);
  assert.equal(deliveryPreferences({ ...settings, zone: "fake" }), null);
  const subscription = deviceSubscription();
  assert.deepEqual(parseDeviceSubscription(subscription), subscription);
  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/test", "https://fcm.googleapis.com.evil.invalid/d", "https://127.0.0.1/private",
    "https://somebody@fcm.googleapis.com/send", "https://fcm.googleapis.com:8443/send",
  ]) assert.equal(parseDeviceSubscription({ ...subscription, endpoint }), null);
  assert.equal(parseDeviceSubscription({ ...subscription, keys: { ...subscription.keys, p256dh: "q".repeat(87) } }), null);
});

test("email adapter uses a fixed transport and generic content with an idempotency key", async () => {
  let sent = 0;
  const transport = notificationTransports({
    MIND_NOTIFICATION_EMAIL_KEY: "fixture", MIND_NOTIFICATION_EMAIL_FROM: "Adrian <alerts@example.invalid>",
  }, async (resource, init) => {
    sent++;
    assert.equal(resource, "https://api.resend.com/emails");
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("idempotency-key"), "stable-operation");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.to, [recipient]);
    assert.equal(body.subject, "Adrian workspace update");
    assert.equal(body.text, "Open Alerts in Adrian to review your workspace update.");
    return Response.json({ id: "provider-acceptance" });
  });
  assert.equal(await transport.email?.send(recipient, "stable-operation"), "accepted");
  assert.equal(sent, 1);
  const withoutReceipt = notificationTransports({
    MIND_NOTIFICATION_EMAIL_KEY: "fixture", MIND_NOTIFICATION_EMAIL_FROM: "alerts@example.invalid",
  }, async () => Response.json({}));
  assert.equal(await withoutReceipt.email?.send(recipient, "stable-operation"), "unknown");
});

test("Web Push encrypts receipts and sends only to the validated endpoint without redirects", async () => {
  const vapid = webPush.generateVAPIDKeys();
  const subscription = deviceSubscription();
  const hash = "b".repeat(64);
  const device = randomUUID();
  const env = {
    MIND_PUSH_PUBLIC_KEY: vapid.publicKey, MIND_PUSH_PRIVATE_KEY: vapid.privateKey,
    MIND_PUSH_SUBJECT: "mailto:operator@example.invalid", MIND_NOTIFICATION_STORAGE_SECRET: "synthetic push encryption test key",
  };
  const transport = notificationTransports(env, async (resource, init) => {
    assert.equal(resource, subscription.endpoint);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("content-encoding"), "aes128gcm");
    assert.equal(headers.get("topic"), hash.slice(0, 32));
    assert.ok(headers.get("authorization")?.startsWith("vapid t="));
    assert.ok(init?.body instanceof Uint8Array);
    assert.equal(Buffer.from(init.body).includes(Buffer.from(device)), false);
    return new Response(null, { status: 201 });
  });
  assert.equal(await transport.push?.send(subscription, device, hash), "accepted");
  assert.equal(notificationTransports({ ...env, MIND_NOTIFICATION_STORAGE_SECRET: "" }).push, undefined);
});

test("the browser worker honors the verified display receipt and opens Alerts in the same workspace", async () => {
  const source = await readFile(new URL("../../../public/adrian-notifications-sw.js", import.meta.url), "utf8");
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const shown: unknown[][] = [];
  const opened: string[] = [];
  const requested: string[] = [];
  let response = 404;
  let completed = Promise.resolve();
  const waitUntil = (work: Promise<void>) => { completed = Promise.resolve(work); };
  runInNewContext(source, {
    URL, URLSearchParams,
    fetch: async (url: string) => { requested.push(url); return { status: response }; },
    self: {
      addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => listeners.set(type, handler),
      registration: { scope: "https://example.invalid/preview/", showNotification: (...args: unknown[]) => { shown.push(args); } },
      clients: { openWindow: (href: string) => { opened.push(href); } },
    },
  });
  const device = randomUUID();
  const hash = "b".repeat(64);
  const push = { data: { json: () => ({ device, hash, body: "private content" }) }, waitUntil };
  listeners.get("push")?.(push);
  await completed;
  assert.equal(shown.length, 0);
  response = 204;
  listeners.get("push")?.(push);
  await completed;
  assert.equal(requested[1], `https://example.invalid/preview/api/mind/notifications?device=${device}&receipt=${hash}`);
  assert.equal(shown.length, 1);
  assert.equal(JSON.stringify(shown).includes("private content"), false);
  listeners.get("notificationclick")?.({ notification: { tag: "adrian-workspace-" + hash, close() {} }, waitUntil });
  await completed;
  assert.deepEqual(opened, ["https://example.invalid/preview/#alerts"]);
  assert.equal(listeners.has("fetch"), false);
});

test("account inbox visibility synchronizes by hash without letting a stale device undo a dismissal", async () => {
  const db = await PGlite.create();
  try {
    for (const name of ["0002_mind.sql", "0027_notification_inbox_marks.sql"]) {
      await db.exec(await readFile(new URL("../../../migrations/" + name, import.meta.url), "utf8"));
    }
    const client = sqlAdapter(db);
    const key = await notificationKey("notice with an owner-only detail");
    const first = await saveNotificationMarks(client, "owner", [{ key, visibility: 1 }]);
    assert.equal(first.status, 200);
    assert.deepEqual(await listNotificationMarks(client, "owner"), [{ key, visibility: 1 }]);
    assert.deepEqual(await listNotificationMarks(client, "other"), []);
    await Promise.all([
      saveNotificationMarks(client, "owner", [{ key, visibility: 2 }]),
      saveNotificationMarks(client, "owner", [{ key, visibility: 1 }]),
    ]);
    assert.deepEqual(await listNotificationMarks(client, "owner"), [{ key, visibility: 2 }]);
    assert.deepEqual(await listNotificationMarks(client, "other"), []);
    assert.equal((await saveNotificationMarks(client, "owner", [{ key: "not-a-digest", visibility: 1 }])).status, 400);
    assert.equal((await saveNotificationMarks(client, "owner", [{ key, visibility: 3 }])).status, 400);
    assert.equal((await saveNotificationMarks(client, "owner", Array(501).fill({ key, visibility: 1 }))).status, 400);
    assert.equal(JSON.stringify(await client.query("select * from mind_notification_mark")).includes("owner-only detail"), false);
  } finally { await db.close(); }
});

test("durable delivery binds consent and current recipient, deduplicates competing passes and refuses stale display", async () => {
  const db = await PGlite.create();
  try {
    for (const name of ["0001_auth.sql", "0002_mind.sql", "0021_c1_research_skills.sql", "0026_notification_delivery.sql", "0032_notification_preference_revisions.sql"]) {
      await db.exec(await readFile(new URL("../../../migrations/" + name, import.meta.url), "utf8"));
    }
    const sql = sqlAdapter(db);
    for (const [id, address, verified] of [["a", recipient, true], ["b", "other@example.invalid", false]]) {
      await sql.query('insert into "user" (id,name,email,"emailVerified") values($1,$1,$2,$3)', [id, address, verified]);
    }
    const device = randomUUID();
    const subscription = deviceSubscription();
    const attemptedPush: string[] = [];
    const mail: string[] = [];
    const transports: NotificationTransports = {
      push: { publicKey: "fixture", storageSecret: "synthetic browser subscription secret", send: async (received, target, hash) => {
        assert.deepEqual(received, subscription);
        assert.equal(target, device);
        attemptedPush.push(hash);
        return "unknown";
      } },
      email: { send: async to => { mail.push(to); return "accepted"; } },
    };
    const push = { action: "enable", channel: "push", device, subscription, preferences: settings };
    const email = { action: "enable", channel: "email", address: "requested-other@example.invalid", preferences: settings };
    assert.equal((await updateNotificationDelivery(sql, "a", push, transports)).status, 200);
    assert.equal((await updateNotificationDelivery(sql, "a", push, transports)).status, 200);
    const stored = JSON.stringify(await sql.query("select endpoint,destination from mind_notification_target where channel='push'"));
    assert.equal(stored.includes(subscription.endpoint), false);
    assert.equal(stored.includes(subscription.keys.auth), false);
    assert.equal((await updateNotificationDelivery(sql, "b", push, transports)).status, 409);
    assert.equal((await updateNotificationDelivery(sql, "b", email, transports)).status, 409);
    assert.equal((await updateNotificationDelivery(sql, "a", email, transports)).status, 200);
    assert.equal((await notificationStatus(sql, "a", device, transports, true)).email.address, recipient);
    assert.equal((await notificationStatus(sql, "b", device, transports, true)).push.subscribed, false);
    const enrolled = Date.now() + 2000;
    const ws = emptyWorkspace();
    ws.audit.push({ id: "old", action: "previous activity", at: new Date(enrolled - 86_400_000).toISOString(), target: "", result: "" });
    ws.audit.push({ id: "new", action: "new activity", at: new Date(enrolled).toISOString(), target: "", result: "private" });
    ws.audit.push({ id: "future", action: "future activity", at: new Date(enrolled + 60_000).toISOString(), target: "", result: "" });
    await sql.query("insert into mind_snapshot(user_id,payload) values($1,$2::jsonb)", ["a", JSON.stringify(ws)]);
    const now = new Date(enrolled + 1000);
    await Promise.all([runNotificationPass(sql, transports, now), runNotificationPass(sql, transports, now)]);
    assert.deepEqual(mail, [recipient]);
    assert.equal(attemptedPush.length, 1);
    assert.equal(await mayDisplayScheduledPush(sql, "a", device, attemptedPush[0], now), true);
    assert.equal(await mayDisplayScheduledPush(sql, "b", device, attemptedPush[0], now), false);
    const states = await sql.query<{ state: string }>("select state from mind_notification_delivery order by state");
    assert.deepEqual(states.map(row => row.state), ["accepted", "unknown"]);
    const receipts = await notificationStatus(sql, "a", device, transports, true);
    assert.equal(receipts.push.lastAttempt?.state, "unknown");
    assert.equal(receipts.email.lastAttempt?.state, "accepted");
    assert.equal((await notificationStatus(sql, "b", device, transports, true)).push.lastAttempt, undefined);
    assert.equal((await runNotificationPass(sql, transports, now)).accepted, 0);
    assert.equal(attemptedPush.length, 1);

    await sql.query("update mind_control set halted=true where user_id=$1", ["a"]);
    await runNotificationPass(sql, transports, new Date(enrolled + 70_000));
    assert.equal(await mayDisplayScheduledPush(sql, "a", device, attemptedPush[0], now), false);
    assert.equal(attemptedPush.length, 1);
    assert.deepEqual(mail, [recipient]);

    await sql.query("update mind_control set halted=false where user_id=$1", ["a"]);
    await updateNotificationDelivery(sql, "b", { action: "disable", channel: "push", device }, transports);
    assert.equal(await mayDisplayScheduledPush(sql, "a", device, attemptedPush[0], now), true);
    const prior = await notificationStatus(sql, "a", device, transports, true);
    const editPush = { action: "preferences", channel: "push", device,
      preferenceRevision: prior.push.preferenceRevision, preferences: { ...settings, activity: false } };
    assert.equal((await updateNotificationDelivery(sql, "b", editPush, transports)).status, 409);
    assert.equal((await updateNotificationDelivery(sql, "a", { ...editPush, device: randomUUID() }, transports)).status, 409);
    assert.equal((await updateNotificationDelivery(sql, "a", editPush, transports)).status, 200);
    assert.equal((await updateNotificationDelivery(sql, "a", editPush, transports)).status, 409);
    const edited = await notificationStatus(sql, "a", device, transports, true);
    assert.equal(edited.push.preferences?.activity, false);
    assert.equal(edited.email.preferences?.activity, true);
    assert.equal(edited.email.preferenceRevision, prior.email.preferenceRevision);
    assert.equal(await mayDisplayScheduledPush(sql, "a", device, attemptedPush[0], now), false);
    assert.equal((await updateNotificationDelivery(sql, "a", {
      ...editPush, preferences: settings, preferenceRevision: edited.push.preferenceRevision,
    }, transports)).status, 200);
    assert.equal(await mayDisplayScheduledPush(sql, "a", device, attemptedPush[0], now), false, "Returning to the prior values cannot revive an old push");
    await updateNotificationDelivery(sql, "a", { action: "disable", channel: "push", device }, transports);
    assert.equal((await updateNotificationDelivery(sql, "a", push, transports)).status, 200);
    assert.equal((await updateNotificationDelivery(sql, "a", editPush, transports)).status, 409, "A previous subscription cannot edit a re-enabled target");
    await updateNotificationDelivery(sql, "a", { action: "disable", channel: "push", device }, transports);
    await sql.query('update "user" set email=$2 where id=$1', ["a", "changed@example.invalid"]);
    await runNotificationPass(sql, transports, new Date(enrolled + 70_000));
    assert.equal(await mayDisplayScheduledPush(sql, "a", device, attemptedPush[0], now), false);
    assert.equal(attemptedPush.length, 1);
    assert.deepEqual(mail, [recipient]);

    // Revoke only after the attempt was committed, before dispatch obtains its locks.
    await updateNotificationDelivery(sql, "a", email, transports);
    const baseTransaction = sql.transaction!;
    let revokedAfterClaim = false;
    sql.transaction = async work => {
      let claimed = false;
      const result = await baseTransaction(async tx => {
        const query = tx.query;
        tx.query = async function <T>(statement: string, params?: unknown[]) {
          const rows = await query<T>(statement, params);
          if (statement.includes("insert into mind_notification_delivery") && rows.length) claimed = true;
          return rows;
        };
        return work(tx);
      });
      if (claimed && !revokedAfterClaim) {
        revokedAfterClaim = true;
        await updateNotificationDelivery(sql, "a", { action: "disable", channel: "email" }, transports);
      }
      return result;
    };
    await runNotificationPass(sql, transports, new Date(enrolled + 70_000));
    assert.equal(revokedAfterClaim, true);
    assert.deepEqual(mail, [recipient]);
  } finally { await db.close(); }
});
