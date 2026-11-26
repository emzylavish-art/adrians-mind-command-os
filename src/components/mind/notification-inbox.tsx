import { useState } from "react";
import type { WorkspaceNotice } from "@/lib/mind/notifications";

export function NotificationInbox({ notices, read, dismissed = [], onRead, onDismiss, onOpen }: { notices: WorkspaceNotice[]; read: string[]; dismissed?: string[]; onRead: (ids: string[]) => void; onDismiss?: (id: string) => void; onOpen: (notice: WorkspaceNotice) => void }) {
  const [filter, setFilter] = useState<"all" | "unread" | "urgent">("unread");
  const [count, setCount] = useState(30);
  const rows = notices.filter((notice) => filter === "all" || (!dismissed.includes(notice.id) && (filter === "urgent" ? notice.urgent : !read.includes(notice.id))));
  return <section className="p-2" aria-label="Notification inbox">
    <div className="flex flex-wrap gap-2">{(["unread", "urgent", "all"] as const).map((value) => <button type="button" key={value} className="min-h-11 rounded-panel border border-line px-3 text-xs" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div>
    <button type="button" className="min-h-11 px-3 text-xs underline" onClick={() => onRead(notices.map((notice) => notice.id))}>Mark all as read</button>
    {rows.length === 0 ? <p className="p-3 text-sm text-muted">No {filter === "all" ? "recorded" : filter} notifications.</p> : null}
    <ul className="max-h-80 overflow-auto">{rows.slice(0, count).map((notice) => <li key={notice.id}><button type="button" className="min-h-11 w-full rounded-panel border border-line p-3 text-left text-sm" onClick={() => { onRead([...read, notice.id]); onOpen(notice); }}><strong>{notice.title}{read.includes(notice.id) ? "" : " · unread"}{dismissed.includes(notice.id) ? " · dismissed" : ""}</strong><span className="block break-words text-xs text-muted">{notice.detail}</span><time className="text-xs text-muted" dateTime={notice.at}>{new Date(notice.at).toLocaleString()}</time></button>{onDismiss && !dismissed.includes(notice.id) && <button type="button" className="min-h-11 px-3 text-xs underline" onClick={() => onDismiss(notice.id)}>Dismiss notice</button>}</li>)}</ul>
    {rows.length > count ? <button type="button" className="min-h-11 px-3 text-sm" onClick={() => setCount((value) => value + 30)}>Show more</button> : null}
    <p className="p-2 text-xs text-muted">Read and dismiss are separate from resolving an approval or error. Read marks apply to this account in this browser. Workspace results follow workspace synchronization; local research remains on this device. External push delivery is not configured here.</p>
  </section>;
}
