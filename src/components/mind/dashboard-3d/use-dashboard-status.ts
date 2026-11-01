import { useCallback, useEffect, useState } from "react";
import type { DashboardStatus } from "@/lib/mind/dashboard/types";

export type StatusState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: DashboardStatus & { ok?: boolean } };

const POLL_MS = 5000;

export function useDashboardStatus() {
  const [state, setState] = useState<StatusState>({ status: "loading" });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/mind/dashboard/status", { signal, cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as DashboardStatus & { ok?: boolean; error?: string };
      if (data.ok === false) throw new Error(data.error || "Status endpoint failed");
      setState({ status: "ready", data });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setState({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void refresh(ac.signal);
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, [refresh]);

  return { state, refresh };
}
