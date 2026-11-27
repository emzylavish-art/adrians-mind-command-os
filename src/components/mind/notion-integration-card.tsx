import { useCallback, useEffect, useRef, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { fetchOauthStatusPayload } from "@/lib/mind/service-board-status";
import { notionIntegrationStatus, type OwnerNotionSnapshot } from "@/lib/mind/notion-integration-status";

/** Reads the same owner-scoped status endpoint as Plugins; never contacts Notion itself. */
export function NotionIntegrationCard({ onOpen }: { onOpen: () => void }) {
  const { user, isPending } = useCurrentUserState();
  const ownerId = user?.id ?? null;
  const [snapshot, setSnapshot] = useState<OwnerNotionSnapshot | null>(null);
  const [checking, setChecking] = useState(false);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    active.current?.abort();
    if (!ownerId || isPending) return;
    const controller = new AbortController();
    active.current = controller;
    setChecking(true);
    void fetchOauthStatusPayload("/api/mind/oauth/notion/status", { bearer: getBearerToken(), signal: controller.signal }).then((status) => {
      if (active.current !== controller || controller.signal.aborted) return;
      setSnapshot({ ownerId, checkedAt: new Date().toISOString(), status });
      setChecking(false);
    });
  }, [ownerId, isPending]);
  useEffect(() => {
    setSnapshot(null);
    setChecking(false);
    refresh();
    const changed = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === "notion-oauth") refresh();
    };
    window.addEventListener("message", changed);
    return () => { active.current?.abort(); active.current = null; window.removeEventListener("message", changed); };
  }, [refresh]);
  const state = notionIntegrationStatus(ownerId, isPending, snapshot);
  return <article className="integration-card">
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <img src="/brand/logos/notion.svg" alt="" className="size-8 shrink-0 rounded-lg object-contain" />
        <h3 className="text-sm font-semibold">Notion</h3>
      </div>
      <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{state.label}</span>
    </div>
    <p className="mt-2 text-sm text-muted" role="status">{state.detail}</p>
    {state.checkedAt ? <p className="mt-2 text-xs text-muted">Connection record checked {new Date(state.checkedAt).toLocaleString()}</p> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={onOpen}>Open Plugins</button>
      {ownerId && !isPending ? <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={checking} onClick={refresh}>{checking ? "Checking…" : "Check status"}</button> : null}
    </div>
  </article>;
}
