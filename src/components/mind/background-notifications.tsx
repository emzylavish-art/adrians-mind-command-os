import { useEffect, useRef, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import type { PreferenceStorage } from "@/lib/mind/account-preferences";
import { BACKGROUND_PUSH_CHANGED, BACKGROUND_PUSH_KEY, notificationDeviceId, type DeliveryChannel, type DeliveryPreferences, type NotificationStatus } from "@/lib/mind/notification-delivery";
import type { NotificationPreferences } from "@/lib/mind/notifications";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { NotificationPreferenceFields } from "./notification-preference-fields";

const deviceStorageKey = "notifications.browser-device.v1";
const endpoint = "/api/mind/notifications";
const channels = [["push", "Browser push"], ["email", "Account email"]] as const;
type PreferenceDraft = { preferences: DeliveryPreferences; revision: string };

function registeredDevice(storage: PreferenceStorage) {
  try {
    if (!storage.persistent) return null;
    const existing = storage.getItem(deviceStorageKey);
    if (notificationDeviceId(existing)) return existing;
    const device = crypto.randomUUID();
    storage.setItem(deviceStorageKey, device);
    return storage.getItem(deviceStorageKey) === device ? device : null;
  } catch { return null; }
}

async function notificationRequest(params: URLSearchParams, body?: object, signal?: AbortSignal) {
  const token = getBearerToken();
  const headers = new Headers(token ? { authorization: `Bearer ${token}` } : {});
  if (body) headers.set("content-type", "application/json");
  const response = await fetch((previewPathPrefix(location.hostname, location.pathname) ?? "") + endpoint + (body ? "" : "?" + params), {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers, signal,
    body: body && JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(typeof data?.error === "string" ? data.error : "Notification settings could not be confirmed.");
  return data;
}

function syncBrowserDelivery(storage: PreferenceStorage, subscribed: boolean) {
  try {
    if ((storage.getItem(BACKGROUND_PUSH_KEY) === "yes") === subscribed) return;
    if (subscribed) storage.setItem(BACKGROUND_PUSH_KEY, "yes");
    else storage.removeItem(BACKGROUND_PUSH_KEY);
    if (storage.getItem("notifications.browser-since.v1")) storage.setItem("notifications.browser-since.v1", String(Date.now()));
    window.dispatchEvent(new Event(BACKGROUND_PUSH_CHANGED));
  } catch { /* Changing browser storage cannot change server consent. */ }
}

function applicationKey(key: string) {
  const encoded = key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "=");
  return Uint8Array.from(atob(encoded), char => char.charCodeAt(0)).buffer;
}

function DeliveryReceipt({ label, channel }: { label: string; channel: NotificationStatus[DeliveryChannel] }) {
  const phrases = { attempted: "Attempt recorded", accepted: "Accepted by the provider", rejected: "Rejected by the provider", unknown: "Delivery outcome unknown" };
  if (!channel.subscribed) return null;
  return <p className="pt-2"><strong>{label}</strong>{" · "}{channel.lastAttempt
    ? <>{phrases[channel.lastAttempt.state]} <time dateTime={channel.lastAttempt.at}>{new Date(channel.lastAttempt.at).toLocaleString()}</time></>
    : channel.lastChecked
      ? <>Worker checked <time dateTime={channel.lastChecked}>{new Date(channel.lastChecked).toLocaleString()}</time></>
      : "Awaiting the first worker check"}</p>;
}

export function BackgroundNotifications({ owner, storage, preferences }: {
  owner: string | null;
  storage: PreferenceStorage;
  preferences: NotificationPreferences;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [device, setDevice] = useState<string | null>(null);
  const [worker, setWorker] = useState<ServiceWorkerRegistration | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<Partial<Record<DeliveryChannel, PreferenceDraft>>>({});
  const mutation = useRef<AbortController | null>(null);
  const browserSupported = typeof window !== "undefined" && window.isSecureContext && "Notification" in window
    && "PushManager" in window && "serviceWorker" in navigator;
  useEffect(() => () => mutation.current?.abort(), [owner]);

  useEffect(() => {
    if (!open || !owner) return;
    const controller = new AbortController();
    const id = registeredDevice(storage);
    setDevice(id);
    const query = new URLSearchParams({ owner, ...(id ? { device: id } : {}) });
    void notificationRequest(query, undefined, controller.signal).then((next: NotificationStatus) => {
      if (controller.signal.aborted) return;
      setStatus(next);
      syncBrowserDelivery(storage, next.push.subscribed);
    }).catch(() => {
      if (!controller.signal.aborted) setMessage("Delivery settings could not be loaded. Reopen this panel to try again.");
    });
    return () => controller.abort();
  }, [open, owner, storage]);

  useEffect(() => {
    if (!open || !device || !browserSupported || !status?.push.available || !status.workerConfigured) return;
    let current = true;
    const prefix = previewPathPrefix(location.hostname, location.pathname) ?? "";
    void navigator.serviceWorker.register(prefix + "/adrian-notifications-sw.js").then(() => navigator.serviceWorker.ready).then(registration => {
      if (current) setWorker(registration);
    }).catch(() => { if (current) setMessage("This browser could not start its notification worker."); });
    return () => { current = false; };
  }, [open, device, browserSupported, status?.push.available, status?.workerConfigured]);

  async function update(action: "enable" | "disable" | "preferences", channel: DeliveryChannel) {
    if (!owner || mutation.current) return;
    const draft = drafts[channel];
    if (action === "preferences" && !draft) return;
    const controller = new AbortController();
    mutation.current = controller;
    const { signal } = controller;
    setWorking(true);
    setMessage("");
    const query = new URLSearchParams({ owner, ...(device ? { device } : {}) });
    const scopedPreferences = {
      ...preferences, research: preferences.research !== false, media: preferences.media !== false,
      urgent: true,
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    let subscription: PushSubscription | null = null;
    try {
      if (action === "enable" && channel === "push") {
        if (!worker || !device || !status?.push.publicKey) throw new Error("This browser cannot subscribe to push notifications here.");
        if (await Notification.requestPermission() !== "granted") throw new Error("Browser permission was not granted. You can change it in site settings.");
        signal.throwIfAborted();
        subscription = await worker.pushManager.getSubscription();
        if (!subscription) {
          subscription = await worker.pushManager.subscribe({
            userVisibleOnly: true, applicationServerKey: applicationKey(status.push.publicKey),
          });
        }
      }
      signal.throwIfAborted();
      await notificationRequest(query, {
        owner, device, channel, action,
        preferences: action === "preferences" ? draft?.preferences : scopedPreferences,
        preferenceRevision: action === "preferences" ? draft?.revision : undefined,
        subscription: subscription?.toJSON(),
      }, signal);
      signal.throwIfAborted();
      if (channel === "push" && action !== "preferences") {
        syncBrowserDelivery(storage, action === "enable");
        if (action === "disable") {
          // The server grant has already been withdrawn even if browser cleanup fails.
          try { await (await worker?.pushManager.getSubscription())?.unsubscribe(); } catch { /* The server receipt still refuses display. */ }
        }
      }
      const confirmed: NotificationStatus = await notificationRequest(query, undefined, signal);
      if (!signal.aborted) {
        setStatus(confirmed);
        setDrafts(previous => ({ ...previous, [channel]: undefined }));
        setMessage(action === "enable" ? "Registered for delivery." : action === "disable" ? "Delivery turned off."
          : channel === "push" ? "Browser push preferences saved." : "Account email preferences saved.");
      }
    } catch (error) {
      if (!signal.aborted) setMessage(error instanceof Error ? error.message : "Notification settings could not be confirmed.");
    } finally {
      mutation.current = null;
      if (!signal.aborted) setWorking(false);
    }
  }

  return <details className="p-3 text-xs" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Background push and email</summary>
    {!owner ? <p>Sign in to manage background delivery.</p> : <>
      <p className="py-2">New subscriptions start with your current inbox choices. You can then set events and quiet hours separately for this browser and your account email. On iPhone or iPad, open Adrian from its Home Screen icon to use push.</p>
      {status && !status.workerConfigured && <p>Background delivery is unavailable until the notification worker is configured.</p>}
      {status && <div className="flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-panel border border-line px-3" aria-pressed={status.push.subscribed}
          disabled={working || (!status.push.subscribed && (!worker || !status.push.available || !status.workerConfigured))}
          onClick={() => void update(status.push.subscribed ? "disable" : "enable", "push")}>{status.push.subscribed ? "Turn off push on this browser" : "Enable push on this browser"}</button>
        <button type="button" className="min-h-11 rounded-panel border border-line px-3" aria-pressed={status.email.subscribed}
          disabled={working || (!status.email.subscribed && (!status.email.available || !status.workerConfigured))}
          onClick={() => void update(status.email.subscribed ? "disable" : "enable", "email")}>{status.email.subscribed ? "Turn off account email" : "Enable account email"}</button>
      </div>}
      {status && channels.map(([channel, label]) => {
        const saved = status[channel].preferences;
        const revision = status[channel].preferenceRevision;
        if (!saved || !revision) return null;
        const draft = drafts[channel];
        const stale = !!draft && draft.revision !== revision;
        const prefs = draft?.preferences ?? saved;
        const edit = (changes: Partial<DeliveryPreferences>) => setDrafts(previous => ({
          ...previous, [channel]: {
            preferences: { ...(previous[channel]?.preferences ?? saved), ...changes },
            revision: previous[channel]?.revision ?? revision,
          },
        }));
        return <fieldset key={channel} disabled={working} className="mt-3 rounded-panel border border-line p-3">
          <legend className="px-1 font-medium">{label} preferences</legend>
          <NotificationPreferenceFields preferences={prefs} change={edit} />
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={prefs.urgent} onChange={event => edit({ urgent: event.target.checked })} />Urgent approvals and errors
          </label>
          <p className="text-muted">Quiet hours use {prefs.zone}.</p>
          <p className="text-muted">Enabled urgent alerts can arrive during quiet hours.</p>
          {stale && <p role="status">These saved preferences changed elsewhere. Start again from the current settings.</p>}
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" className="min-h-11 rounded-panel border border-line px-3"
              disabled={!draft || stale} onClick={() => void update("preferences", channel)}>Save {label.toLowerCase()} preferences</button>
            {draft && <button type="button" className="min-h-11 px-3"
              onClick={() => setDrafts(previous => ({ ...previous, [channel]: undefined }))}>Discard {label.toLowerCase()} changes</button>}
          </div>
        </fieldset>;
      })}
      {status?.email.address && <p className="break-all pt-2">Verified account email: {status.email.address}</p>}
      {status && <><DeliveryReceipt label="Browser push" channel={status.push} /><DeliveryReceipt label="Account email" channel={status.email} /></>}
      {message && <p className="py-2" role="status">{message}</p>}
    </>}
  </details>;
}
