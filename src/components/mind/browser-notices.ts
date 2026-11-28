import { useEffect, useRef, useState } from "react";
import { isQuietHour, type NotificationPreferences, type WorkspaceNotice } from "@/lib/mind/notifications";
import type { PreferenceStorage } from "@/lib/mind/account-preferences";
import { BACKGROUND_PUSH_CHANGED, BACKGROUND_PUSH_KEY } from "@/lib/mind/notification-delivery";

const CHANNEL_KEY = "notifications.browser-since.v1";
const RECEIPTS_KEY = "notifications.browser-receipts.v1";
const DAY_MS = 86_400_000;

function enabledSince(storage: PreferenceStorage) {
  try { return Number(storage.getItem(CHANNEL_KEY)) || 0; } catch { return 0; }
}

function hasBackgroundDelivery(storage: PreferenceStorage) {
  try { return storage.getItem(BACKGROUND_PUSH_KEY) === "yes"; } catch { return false; }
}

/** Deliver only new events observed while this workspace is open. The OS controls presentation. */
export function useBrowserNotices(storage: PreferenceStorage, notices: WorkspaceNotice[], prefs: NotificationPreferences) {
  const [since, setSince] = useState(() => enabledSince(storage));
  const [background, setBackground] = useState(() => hasBackgroundDelivery(storage));
  const [status, setStatus] = useState("");
  const [opened] = useState(() => Date.now());
  const active = useRef(false);
  const busy = useRef(false);
  const available = typeof window !== "undefined" && typeof Notification === "function" && !!navigator.locks && storage.persistent === true && !!storage.keyFor;
  useEffect(() => {
    active.current = true;
    const syncBackground = () => {
      setBackground(hasBackgroundDelivery(storage));
      setSince(enabledSince(storage));
    };
    syncBackground();
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === storage.keyFor?.(CHANNEL_KEY)) setSince(enabledSince(storage));
      if (event.key === null || event.key === storage.keyFor?.(BACKGROUND_PUSH_KEY)) syncBackground();
    };
    window.addEventListener("storage", sync);
    window.addEventListener(BACKGROUND_PUSH_CHANGED, syncBackground);
    return () => { active.current = false; window.removeEventListener("storage", sync); window.removeEventListener(BACKGROUND_PUSH_CHANGED, syncBackground); };
  }, [storage]);

  async function toggle() {
    if (!available || busy.current) return;
    busy.current = true;
    try {
      const enabling = !since;
      if (enabling && await Notification.requestPermission() !== "granted") {
        if (active.current) setStatus("Browser permission was not granted. You can change it in this site's browser settings.");
        return;
      }
      if (!active.current) return;
      const next = enabling ? Date.now() : 0;
      storage.setItem(CHANNEL_KEY, String(next));
      setSince(next);
      setStatus("");
    } catch { if (active.current) setStatus("The browser could not save this notification choice."); }
    finally { busy.current = false; }
  }

  useEffect(() => {
    if (!available || !since || background || Notification.permission !== "granted") return;
    let current = true;
    const now = Date.now();
    const floor = Math.max(opened, since, now - DAY_MS);
    const fresh = notices.filter(notice => Date.parse(notice.at) > floor && Date.parse(notice.at) <= now);
    if (!fresh.length) return;
    void navigator.locks.request(storage.keyFor!(RECEIPTS_KEY), () => {
      if (!current || hasBackgroundDelivery(storage) || enabledSince(storage) !== since || Notification.permission !== "granted") return;
      const raw: unknown = JSON.parse(storage.getItem(RECEIPTS_KEY) || "[]");
      if (!Array.isArray(raw)) throw Error("Invalid delivery history");
      const handled = new Map<string, number>();
      for (const item of raw) {
        if (!Array.isArray(item) || typeof item[0] !== "string" || typeof item[1] !== "number") throw Error("Invalid delivery receipt");
        if (item[1] > now - DAY_MS) handled.set(item[0], item[1]);
      }
      for (const notice of fresh) {
        if (handled.has(notice.id)) continue;
        handled.set(notice.id, Date.parse(notice.at));
        // Reserve before asking the OS. Another tab must not retry an ambiguous delivery.
        storage.setItem(RECEIPTS_KEY, JSON.stringify([...handled]));
        if (notice.urgent || !isQuietHour(prefs, new Date().getHours())) {
          new Notification("Adrian workspace update", { body: "Open Alerts in Adrian to review the update." });
        }
      }
    }).catch(() => {
      if (current) setStatus("Browser alert delivery could not be confirmed. Your updates are in the inbox.");
    });
    return () => { current = false; };
  }, [available, storage, since, background, notices, prefs, opened]);

  const permissionStatus = available && since && Notification.permission !== "granted"
    ? "Browser permission is off. Update the permission in this site's browser settings." : "";
  return { enabled: !!since, available, status: background ? "Background push handles browser alerts on this device." : permissionStatus || status, toggle };
}
