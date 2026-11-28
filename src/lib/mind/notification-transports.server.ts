import { createECDH } from "node:crypto";
import webPush from "web-push";
import { connectorTokenSecretStatus } from "./connectors/crypto.ts";
import type { DeviceSubscription } from "./notification-delivery.ts";

type Vapid = { publicKey: string; privateKey: string; subject: string };
type EmailSender = { from: string; key: string };
export type DeliveryOutcome = "accepted" | "rejected" | "unknown" | "expired";
export type NotificationTransports = {
  push?: { publicKey: string; storageSecret: string; send: (destination: DeviceSubscription, device: string, hash: string) => Promise<DeliveryOutcome> };
  email?: { send: (to: string, idempotencyKey: string) => Promise<DeliveryOutcome> };
};

const pushHosts = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "web.push.apple.com"]);
const concealmentText = "Open Alerts in Adrian to review your workspace update.";

/** Push subscription URLs are capabilities. Only known browser push services can receive requests. */
export function parseDeviceSubscription(value: unknown): DeviceSubscription | null {
  if (!value || typeof value !== "object") return null;
  const { endpoint, keys } = value as { endpoint?: unknown; keys?: Record<string, unknown> };
  if (typeof endpoint !== "string" || endpoint.length > 2048 || !keys
    || typeof keys.auth !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth)
    || typeof keys.p256dh !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh)) return null;
  try {
    const url = new URL(endpoint);
    const approved = pushHosts.has(url.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
    if (url.protocol !== "https:" || !approved || url.port || url.username || url.password || url.hash || (url.pathname === "/" && !url.search)) return null;
    const key = Buffer.from(keys.p256dh, "base64url");
    if (key[0] !== 4) return null;
    const verifier = createECDH("prime256v1");
    verifier.generateKeys();
    verifier.computeSecret(key);
    return { endpoint: url.href, keys: { auth: keys.auth, p256dh: keys.p256dh } };
  } catch { return null; }
}

function vapidConfig(env: NodeJS.ProcessEnv): Vapid | undefined {
  const { MIND_PUSH_PUBLIC_KEY: publicKey, MIND_PUSH_PRIVATE_KEY: privateKey, MIND_PUSH_SUBJECT: subject } = env;
  if (!publicKey || !privateKey || !subject || !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)) return;
  try {
    const curve = createECDH("prime256v1");
    const privateBytes = Buffer.from(privateKey, "base64url");
    if (privateBytes.length !== 32 || privateBytes.toString("base64url") !== privateKey) return;
    curve.setPrivateKey(privateBytes);
    if (curve.getPublicKey().toString("base64url") === publicKey) return { publicKey, privateKey, subject };
  } catch { /* An invalid key leaves push unavailable. */ }
}

function emailConfig(env: NodeJS.ProcessEnv): EmailSender | undefined {
  const { MIND_NOTIFICATION_EMAIL_FROM: from, MIND_NOTIFICATION_EMAIL_KEY: key } = env;
  if (key && from && !/[\r\n]/.test(from) && /@[^\s@]+\.[^\s@>]+>?$/.test(from)) return { from, key };
}

function providerOutcome(status: number, push = false): DeliveryOutcome {
  if (status >= 200 && status < 300) return "accepted";
  if (push && (status === 404 || status === 410)) return "expired";
  if (status >= 400 && status < 500 && status !== 408) return "rejected";
  return "unknown";
}

export function notificationTransports(env = process.env, fetchImpl = fetch): NotificationTransports {
  const push = vapidConfig(env);
  const storage = connectorTokenSecretStatus(env.MIND_NOTIFICATION_STORAGE_SECRET ?? env.CONNECTOR_TOKEN_SECRET ?? "");
  const email = emailConfig(env);
  return {
    push: push && storage.ok ? { publicKey: push.publicKey, storageSecret: storage.secret, async send(destination, device, hash) {
      const subscription = parseDeviceSubscription(destination);
      if (!subscription) return "rejected";
      try {
        const request = webPush.generateRequestDetails(subscription, JSON.stringify({ device, hash }), {
          vapidDetails: push, TTL: 300, topic: hash.slice(0, 32), contentEncoding: "aes128gcm",
        });
        const result = await fetchImpl(subscription.endpoint, {
          method: request.method, headers: request.headers as Record<string, string>,
          body: new Uint8Array(request.body), redirect: "error", signal: AbortSignal.timeout(5000),
        });
        return providerOutcome(result.status, true);
      } catch { return "unknown"; }
    } } : undefined,
    email: email && { async send(to, idempotencyKey) {
      try {
        const result = await fetchImpl("https://api.resend.com/emails", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
          headers: { authorization: `Bearer ${email.key}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: JSON.stringify({ from: email.from, to: [to], subject: "Adrian workspace update", text: concealmentText }),
        });
        if (!result.ok) return providerOutcome(result.status);
        const receipt: unknown = await result.json();
        return receipt && typeof receipt === "object" && "id" in receipt && typeof receipt.id === "string" && receipt.id ? "accepted" : "unknown";
      } catch { return "unknown"; }
    } },
  };
}
