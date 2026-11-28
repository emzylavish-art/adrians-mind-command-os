import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { deliveryAllowed, deliveryPreferences } from "./notification-delivery.ts";
import { mayDisplayScheduledPush, notificationStatus, runNotificationPass, updateNotificationDelivery } from "./notification-delivery.server.ts";
import { notificationTransports, parseDeviceSubscription, type NotificationTransports } from "./notification-transports.server.ts";
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
});

test("durable delivery binds consent and current recipient, deduplicates competing passes and refuses stale display", async () => {
  const db = await PGlite.create();
  try {
    for (const name of ["0001_auth.sql", "0002_mind.sql", "0021_c1_research_skills.sql", "0026_notification_delivery.sql"]) {
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
      push: { publicKey: "fixture", send: async (received, target, hash) => {
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
    await sql.query('update "user" set email=$2 where id=$1', ["a", "changed@example.invalid"]);
    await updateNotificationDelivery(sql, "b", { action: "disable", channel: "push", device }, transports);
    assert.equal(await mayDisplayScheduledPush(sql, "a", device, attemptedPush[0], now), true);
    await updateNotificationDelivery(sql, "a", { action: "disable", channel: "push", device }, transports);
    await runNotificationPass(sql, transports, new Date(enrolled + 70_000));
    assert.equal(await mayDisplayScheduledPush(sql, "a", device, attemptedPush[0], now), false);
    assert.equal(attemptedPush.length, 1);
    assert.deepEqual(mail, [recipient]);
  } finally { await db.close(); }
});
