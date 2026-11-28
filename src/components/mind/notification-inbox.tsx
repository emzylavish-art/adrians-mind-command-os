import { NotificationPreferenceFields } from "./notification-preference-fields";
import type { Workspace } from "@/lib/mind/types";
import type { PreferenceStorage } from "@/lib/mind/account-preferences";
import { useBrowserNotices } from "./browser-notices";
import { workspaceNotices, isQuietHour, notificationIds, readNotificationPreferences, type NotificationPreferences } from "@/lib/mind/notifications";
import { useState, useMemo, useEffect } from "react";
import { Activity, Bell, CalendarClock, CheckCheck, FileSearch, Image, ListChecks, X } from "lucide-react";
import type { WorkspaceNotice } from "@/lib/mind/notifications";
import { useSharedInboxMarks } from "./shared-inbox-marks";

const categories = {
  runs: [ListChecks, "Run"],
  scheduled: [CalendarClock, "Schedule"],
  activity: [Activity, "Activity"],
  research: [FileSearch, "Research"],
  chat: [Image, "Chat media"],
} as const;

type InboxProps = {
  notices: WorkspaceNotice[];
  read: string[];
  dismissed?: string[];
  onRead: (ids: string[]) => void;
  onDismiss?: (id: string) => void;
  onOpen: (notice: WorkspaceNotice) => void;
  syncError?: string;
};

export function NotificationInbox({ notices, read, dismissed = [], onRead, onDismiss, onOpen, syncError }: InboxProps) {
  const [filter, setFilter] = useState<"All" | "Unread" | "Urgent">("Unread");
  const [count, setCount] = useState(30);
  const readIds = new Set(read);
  const dismissedIds = new Set(dismissed);
  const active = notices.filter(notice => !dismissedIds.has(notice.id));
  const unread = active.filter(notice => !readIds.has(notice.id));
  const urgent = active.filter(notice => notice.urgent);
  const groups = { Unread: unread, Urgent: urgent, All: notices };
  const rows = groups[filter];
  return <section className="space-y-3 p-3" aria-label="Notification inbox">
    <header className="flex items-center gap-2">
      <Bell size={20} aria-hidden="true" />
      <h2 className="font-display text-lg font-semibold">Notifications</h2>
      <button type="button" disabled={!unread.length} className="ml-auto flex min-h-11 items-center gap-1 px-1 text-xs disabled:opacity-50" onClick={() => onRead(unread.map(notice => notice.id))}>
        <CheckCheck size={16} aria-hidden="true" />Mark all as read
      </button>
    </header>
    {syncError && <p className="text-sm text-muted" role="status">{syncError}</p>}
    <div className="flex flex-wrap gap-1 rounded-panel bg-surface-2 p-1" aria-label="Notification filters" role="group">
      {(["Unread", "Urgent", "All"] as const).map(value => <button key={value} type="button" aria-pressed={filter === value}
        className="min-h-11 flex-1 rounded-panel px-2 text-xs font-medium aria-pressed:bg-fg aria-pressed:text-bg"
        onClick={() => { setFilter(value); setCount(30); }}>{value} <span>{groups[value].length}</span></button>)}
    </div>
    <p className="sr-only" role="status">{rows.length} {filter.toLowerCase()} notifications</p>
    {rows.length === 0 && <p className="rounded-panel border border-line p-4 text-sm text-muted">No {filter === "All" ? "recorded" : filter.toLowerCase()} notifications.</p>}
    <ul className="max-h-80 divide-y divide-line overflow-y-auto">
      {rows.slice(0, count).map(notice => {
        const [Icon, category] = categories[notice.view];
        const dismissed = dismissedIds.has(notice.id);
        return <li key={notice.id} className="flex items-start gap-1 py-1">
          <button type="button" className="flex min-h-11 min-w-0 flex-1 gap-3 rounded-panel p-2 text-left hover:bg-surface-2"
            onClick={() => { onRead([notice.id]); onOpen(notice); }}>
            <span className={`mt-1 grid size-8 shrink-0 place-items-center rounded-panel bg-surface-2 ${notice.urgent ? "text-danger" : "text-muted"}`}><Icon size={16} aria-hidden="true" /></span>
            <span className="min-w-0">
              <span className="block text-xs text-muted">{category}{notice.urgent ? " · Needs attention" : ""}{dismissed ? " · Dismissed" : !readIds.has(notice.id) ? " · Unread" : ""}</span>
              <strong className="block break-words text-sm">{notice.title}</strong>
              <span className="block break-words text-xs text-muted">{notice.detail}</span>
              <time className="text-xs text-muted" dateTime={notice.at}>{new Date(notice.at).toLocaleString()}</time>
            </span>
          </button>
          {onDismiss && !dismissed && <button type="button" className="grid size-11 shrink-0 place-items-center rounded-panel text-muted hover:bg-surface-2" aria-label={`Dismiss notice: ${notice.title}`} onClick={() => onDismiss(notice.id)}><X aria-hidden="true" size={15} /></button>}
        </li>;
      })}
    </ul>
    {rows.length > count && <button type="button" className="min-h-11 px-3 text-sm" onClick={() => setCount(value => value + 30)}>Show more</button>}
  </section>;
}

export function InboxNotificationSettings({ preferences, change, browser }: {
  preferences: NotificationPreferences; change: (value: NotificationPreferences) => void;
  browser: ReturnType<typeof useBrowserNotices>;
}) {
  return <section className="settings-card space-y-2 rounded-panel p-4" aria-label="Inbox and open-browser alerts">
    <h3 className="font-semibold">Inbox and open-browser alerts</h3>
    <NotificationPreferenceFields preferences={preferences} change={change} />
    <p className="text-sm text-muted">These quiet hours use this device’s time zone. Approvals and errors remain visible.</p>
    <button type="button" className="min-h-11 rounded-panel border border-line px-3" disabled={!browser.available} aria-pressed={browser.enabled}
      onClick={() => void browser.toggle()}>{browser.enabled ? "Disable open-browser alerts" : "Enable open-browser alerts"}</button>
    <p className="text-sm text-muted">{browser.available ? "Browser alerts use the selected inbox events while Adrian is open." : "Open-browser alerts are unavailable in this browser."}</p>
    {browser.status && <p role="status" className="text-sm">{browser.status}</p>}
  </section>;
}

export function useWorkspaceInbox(ws: Workspace, researchHistory: Parameters<typeof workspaceNotices>[2], preferenceStorage: PreferenceStorage,
  setNotice: (value: string) => void, owner: string | null, open: boolean) {
  function loadNoticeState() {
    return {
      owner: preferenceStorage,
      read: notificationIds(preferenceStorage, "notifications.read.v1"),
      dismissed: notificationIds(preferenceStorage, "notifications.dismissed.v1"),
      preferences: readNotificationPreferences(preferenceStorage),
    };
  }
  const [storedNotices, setStoredNotices] = useState(loadNoticeState);
  const noticeState = storedNotices.owner === preferenceStorage ? storedNotices : loadNoticeState();
  const { read: localRead, dismissed: localDismissed, preferences: notificationPreferences } = noticeState;
  useEffect(() => {
    setStoredNotices(loadNoticeState());
    const keys = ["notifications.read.v1", "notifications.dismissed.v1", "notifications.preferences.v1"]
      .map(key => preferenceStorage.keyFor?.(key));
    function sync(event: StorageEvent) {
      if (event.key === null || keys.includes(event.key)) setStoredNotices(loadNoticeState());
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [preferenceStorage]);
  const notifications = useMemo(() => workspaceNotices(ws, notificationPreferences, researchHistory), [ws.runs, ws.schedules, ws.audit, ws.agents, ws.chats, notificationPreferences, researchHistory]);
  const shared = useSharedInboxMarks(owner, open, { read: localRead, dismissed: localDismissed }, notifications.map(entry => entry.id));
  const readNotices = [...new Set([...localRead, ...shared.marks.read])];
  const dismissedNotices = [...new Set([...localDismissed, ...shared.marks.dismissed])];
  const browserNotices = useBrowserNotices(preferenceStorage, notifications, notificationPreferences);
  const unreadNoticeCount = notifications.filter((entry) => !readNotices.includes(entry.id) && !dismissedNotices.includes(entry.id) && (entry.urgent || !isQuietHour(notificationPreferences, new Date().getHours()))).length;
  function markNotices(field: "read" | "dismissed", ids: string[]) {
    const key = "notifications." + field + ".v1";
    const next = [...new Set([...noticeState[field], ...notificationIds(preferenceStorage, key), ...ids])].slice(-5000);
    setStoredNotices({ ...noticeState, [field]: next });
    try { preferenceStorage.setItem(key, JSON.stringify(next)); }
    catch { setNotice("Notification marks apply for this session. Device storage is unavailable."); }
    if (owner) shared.sync();
  }
  function markNoticesRead(ids: string[]) { markNotices("read", ids); }
  function changeNotificationPreferences(next: NotificationPreferences) {
    setStoredNotices({ ...noticeState, preferences: next });
    try { preferenceStorage.setItem("notifications.preferences.v1", JSON.stringify(next)); } catch { setNotice("Notification preferences apply for this session; browser storage is unavailable."); }
  }

  return { notifications, unreadNoticeCount, notificationPreferences, readNotices, dismissedNotices, browserNotices, markNotices, markNoticesRead, changeNotificationPreferences, notificationSyncError: shared.error };
}
