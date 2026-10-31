import { useEffect, useState } from "react";
import { emptyWorkspace, loadWorkspace, WORKSPACE_KEY } from "./workspace";
import type { Workspace } from "./types";

export function useMindWorkspace() {
  const [ws, setWs] = useState<Workspace>(emptyWorkspace);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setWs(loadWorkspace(localStorage));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(ws));
  }, [ready, ws]);

  return { ws, ready, setWs };
}
