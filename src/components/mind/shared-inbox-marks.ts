import { useEffect, useRef, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { notificationKey, NOTIFICATION_MARK_BATCH, NOTIFICATION_MARK_LIMIT, readNotificationMarks, type NotificationMark } from "@/lib/mind/notification-marks";

type InboxMarks = { read: string[]; dismissed: string[] };
const empty: InboxMarks = { read: [], dismissed: [] };

async function request(owner: string, signal: AbortSignal, marks?: NotificationMark[]) {
  const bearer = getBearerToken();
  const headers = new Headers(bearer ? { authorization: `Bearer ${bearer}` } : {});
  if (marks) headers.set("content-type", "application/json");
  const prefix = previewPathPrefix(location.hostname, location.pathname) ?? "";
  const endpoint = prefix + "/api/mind/notifications";
  const query = new URLSearchParams({ owner, marks: "1" });
  const response = await fetch(marks ? endpoint : endpoint + "?" + query, {
    method: marks ? "POST" : "GET", credentials: "same-origin", signal, headers, cache: "no-store",
    body: marks && JSON.stringify({ action: "mark", owner, marks }),
  });
  if (!response.ok) throw new Error("The account inbox could not be synchronized.");
  return response.json();
}

async function synchronize(owner: string, local: InboxMarks, noticeIds: string[], signal: AbortSignal) {
  const response = await request(owner, signal);
  const marks = readNotificationMarks(response.marks, NOTIFICATION_MARK_LIMIT);
  if (!marks) throw new Error("The account returned invalid inbox marks.");
  const shared = new Map(marks.map(row => [row.key, row.visibility]));
  const localIds = [...new Set([...local.read, ...local.dismissed])].slice(-NOTIFICATION_MARK_LIMIT);
  const allIds = [...new Set([...localIds, ...noticeIds])];
  const mapped = new Map(await Promise.all(allIds.map(async id => [id, await notificationKey(id)] as const)));
  const dismissed = new Set(local.dismissed);
  const newMarks = localIds.flatMap(id => {
    const key = mapped.get(id)!;
    const visibility = dismissed.has(id) ? 2 : 1;
    return visibility > (shared.get(key) ?? 0) ? [{ key, visibility } satisfies NotificationMark] : [];
  });
  for (let i = 0; i < newMarks.length; i += NOTIFICATION_MARK_BATCH) {
    const batch = newMarks.slice(i, i + NOTIFICATION_MARK_BATCH);
    signal.throwIfAborted();
    const result = await request(owner, signal, batch);
    if (!result.saved) throw new Error("The account could not confirm the inbox marks.");
    for (const row of batch) shared.set(row.key, row.visibility);
  }
  const result: InboxMarks = { read: [], dismissed: [] };
  for (const id of noticeIds) {
    const mark = shared.get(mapped.get(id)!);
    if (mark) result.read.push(id);
    if (mark === 2) result.dismissed.push(id);
  }
  return result;
}

export function useSharedInboxMarks(owner: string | null, open: boolean, local: InboxMarks, noticeIds: string[]) {
  const details = useRef({ local, noticeIds });
  details.current = { local, noticeIds };
  const [refresh, refreshEpoch] = useState(0);
  const [result, setResult] = useState<{ owner: string; marks: InboxMarks; error: string } | null>(null);
  const visible = JSON.stringify(noticeIds);
  useEffect(() => {
    if (owner && open) refreshEpoch(value => value + 1);
  }, [owner, open, visible]);
  useEffect(() => {
    if (!owner || !open) return;
    const sync = () => refreshEpoch(value => value + 1);
    window.addEventListener("focus", sync);
    window.addEventListener("online", sync);
    const interval = window.setInterval(sync, 30_000);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("online", sync);
      window.clearInterval(interval);
    };
  }, [owner, open]);
  useEffect(() => {
    if (!owner || !refresh) return;
    const controller = new AbortController();
    const { local, noticeIds } = details.current;
    void synchronize(owner, local, noticeIds, controller.signal).then(marks => {
      if (!controller.signal.aborted) setResult({ owner, marks, error: "" });
    }).catch(() => {
      if (!controller.signal.aborted) setResult(previous => ({
        owner, marks: previous?.owner === owner ? previous.marks : empty,
        error: "Account inbox sync is unavailable. This device keeps its marks.",
      }));
    });
    return () => controller.abort();
  }, [owner, refresh]);
  return {
    marks: result?.owner === owner ? result?.marks ?? empty : empty,
    error: result?.owner === owner ? result?.error ?? "" : "",
    sync: () => refreshEpoch(value => value + 1),
  };
}
