import { isQuietHour, type NotificationPreferences, type WorkspaceNotice } from "./notifications.ts";

export type DeliveryPreferences = NotificationPreferences & { zone: string };
export type DeliveryChannel = "push" | "email";
export type NotificationStatus = {
  push: { available: boolean; subscribed: boolean; publicKey?: string };
  email: { available: boolean; subscribed: boolean; address?: string };
  workerConfigured: boolean;
};
export type DeviceSubscription = { endpoint: string; keys: { auth: string; p256dh: string } };
export const BACKGROUND_PUSH_KEY = "notifications.background-push.v1";
export const BACKGROUND_PUSH_CHANGED = "adrian-background-push-changed";

export function notificationDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function deliveryPreferences(value: unknown): DeliveryPreferences | null {
  if (!value || typeof value !== "object") return null;
  const { completedRuns, activity, research, media, quietStart, quietEnd, zone } = value as Record<string, unknown>;
  const hour = (input: unknown): input is number | null =>
    input === null || (typeof input === "number" && Number.isInteger(input) && input >= 0 && input < 24);
  if (typeof completedRuns !== "boolean" || typeof activity !== "boolean" || typeof research !== "boolean" || typeof media !== "boolean"
    || !hour(quietStart) || !hour(quietEnd) || typeof zone !== "string" || zone.length > 80) return null;
  try {
    const canonical = new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
    return { completedRuns, activity, research, media, quietStart, quietEnd, zone: canonical };
  } catch { return null; }
}

export function deliveryAllowed(event: Pick<WorkspaceNotice, "urgent">, prefs: DeliveryPreferences, now: Date) {
  const hour = new Intl.DateTimeFormat("en", { timeZone: prefs.zone, hour: "numeric", hourCycle: "h23" })
    .formatToParts(now).find(part => part.type === "hour");
  return event.urgent || !isQuietHour(prefs, Number(hour?.value));
}
