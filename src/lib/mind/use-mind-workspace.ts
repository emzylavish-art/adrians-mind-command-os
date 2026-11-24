import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { accountImageStore } from "./media/blob-store";
import { createWorkspaceCheckpoint } from "./workspace-checkpoint";
import { loadMindCopy, saveMindCopy } from "./server";
import { chooseServerSync } from "./sync";
import type { Workspace } from "./types";
import { accountWorkspaceKey, emptyWorkspace, mergeMemoryState, loadWorkspaceForAccount } from "./workspace";
import { SAVE_FAIL, saveFailureMessage } from "./save-error";

function hasContent(ws: Workspace) {
  return ws.chats.length + ws.memories.length + ws.projects.length + ws.files.length + (ws.deletedMemoryIds?.length ?? 0) + ws.audit.length + ws.agents.length > 0;
}

function reconcileStoredRecords(ws: Workspace, stored: Workspace): Workspace {
  const missing = stored.agents.filter((agent) => !ws.agents.some((item) => item.id === agent.id));
  return { ...ws, ...mergeMemoryState(ws, stored), agents: [...ws.agents, ...missing] };
}


export function useMindWorkspace(userId: string | null = "dev-user", email: string | null = null) {
  const scope = useMemo(() => ({ userId, checkpoint: createWorkspaceCheckpoint(), images: accountImageStore(userId), empty: emptyWorkspace() }), [userId, email]);
  const [loaded, setLoaded] = useState<{ scope: typeof scope; workspace: Workspace } | null>(null);
  const ready = loaded?.scope === scope;
  const ws = ready ? loaded.workspace : scope.empty;
  const setWs = useCallback((action: SetStateAction<Workspace>) => {
    setLoaded((current) => current?.scope === scope
      ? { scope, workspace: typeof action === "function" ? action(current.workspace) : action }
      : current);
  }, [scope]);
  const [syncNote, setSyncNote] = useState("Browser copy. Server copy has not been checked.");
  const [serverHeld, setServerHeld] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const followServer = useRef(false);
  const savedJson = useRef<string | null>(null);
  const latest = useRef(ws);
  useLayoutEffect(() => { latest.current = ws; }, [ws]);
  const persistGen = useRef(0);
  const activeScope = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => { activeScope.current = null; };
  }, [scope]);
  const writeQueue = useRef(Promise.resolve());
  const pendingWrites = useRef(0);
  const saveForOwner = useCallback((workspace: Workspace, gen: number) => {
    // Serialize snapshots so a slow older request cannot finish after a new workspace or wipe.
    pendingWrites.current++;
    const result = writeQueue.current.then(async () => {
      if (!userId || activeScope.current !== scope || gen !== persistGen.current) {
        return { ok: false as const, error: "The account workspace changed before saving." };
      }
      return saveMindCopy({ data: { workspace, ownerId: userId } });
    });
    writeQueue.current = result.then(() => {}, () => {}).finally(() => { pendingWrites.current--; });
    return result;
  }, [scope, userId]);

  useEffect(() => {
    let cancel = false;
    const loadGen = ++persistGen.current;
    followServer.current = false;
    savedJson.current = null;
    setServerHeld(false);
    setSaveError(null);
    setSyncNote("Browser copy. Server copy has not been checked.");
    void (async () => {
      let localRaw = emptyWorkspace();
      try {
        if (userId) localRaw = loadWorkspaceForAccount(localStorage, userId, email);
      } catch {
        setSaveError("This browser could not read its saved workspace.");
        return;
      }
      let local = localRaw;
      try {
        local = (await scope.checkpoint.hydrate(localRaw, scope.images)) as Workspace;
      } catch {
        local = localRaw;
      }
      if (cancel || loadGen !== persistGen.current) return;
      local = reconcileStoredRecords(local, localRaw);
      setLoaded({ scope, workspace: local });
      if (!userId) return;
      try {
        const result = await loadMindCopy({ data: { ownerId: userId } });
        if (cancel || loadGen !== persistGen.current) return;
        if (!result.ok) {
          followServer.current = false;
          setSyncNote("Browser copy only. The server copy was not read. Nothing was deleted.");
          return;
        }
        const browser = latest.current === scope.empty ? local : latest.current;
        const choice = chooseServerSync(hasContent(browser), Boolean(result.workspace && hasContent(result.workspace)));
        if (choice === "use-server" && result.workspace) {
          let serverWs = result.workspace as Workspace;
          try {
            serverWs = (await scope.checkpoint.hydrate(serverWs, scope.images)) as Workspace;
          } catch {
            /* keep raw */
          }
          if (cancel || loadGen !== persistGen.current) return;
          if (latest.current !== scope.empty && hasContent(latest.current)) {
            setWs((current) => ({ ...current, ...mergeMemoryState(current, serverWs) }));
            followServer.current = false;
            setServerHeld(true);
            setSyncNote("This browser kept its own copy. The server copy was not overwritten.");
            return;
          }
          followServer.current = true;
          savedJson.current = JSON.stringify(result.workspace);
          setWs((current) => hasContent(current) ? current : reconcileStoredRecords(serverWs, localRaw));
          setSyncNote("Loaded the server copy because this browser was empty. It is still not cloud backup.");
          return;
        }
        if (loadGen !== persistGen.current) return;
        if (choice === "upload-local") {
          followServer.current = true;
          const saved = await saveForOwner(browser, loadGen);
          if (cancel || loadGen !== persistGen.current) return;
          const message = saveFailureMessage(saved);
          if (message) {
            setSaveError(message);
            setSyncNote(message);
          } else {
            savedJson.current = JSON.stringify(browser);
            setSyncNote("This browser's copy was saved to the local server database. It is not cloud backup.");
          }
          return;
        }
        if (choice === "keep-local") {
          if (result.workspace) {
            const server = result.workspace as Workspace;
            setWs((current) => ({ ...current, ...mergeMemoryState(current, server) }));
          }
          followServer.current = false;
          setServerHeld(true);
          setSyncNote("This browser kept its own copy. The server copy was not overwritten.");
          return;
        }
        followServer.current = true;
        savedJson.current = JSON.stringify(local);
        setSyncNote("Nothing is stored yet. This is not cloud backup.");
      } catch {
        if (cancel || loadGen !== persistGen.current) return;
        followServer.current = false;
        setSyncNote("Browser copy only. Sign in may be required before a server copy can be saved.");
      }
    })();
    return () => {
      cancel = true;
      ++persistGen.current;
    };
  }, [userId, email, scope, setWs, saveForOwner]);

  useEffect(() => {
    if (!ready || !userId) return;
    const reconcile = (event: StorageEvent) => {
      if (event.key !== accountWorkspaceKey(userId) || event.storageArea !== localStorage) return;
      const stored = loadWorkspaceForAccount(localStorage, userId, email);
      setWs((current) => {
        const next = mergeMemoryState(current, stored);
        if (JSON.stringify(next.memories) === JSON.stringify(current.memories) &&
            JSON.stringify(next.deletedMemoryIds ?? []) === JSON.stringify(current.deletedMemoryIds ?? [])) return current;
        return { ...current, ...next };
      });
    };
    window.addEventListener("storage", reconcile);
    return () => window.removeEventListener("storage", reconcile);
  }, [ready, userId, email, setWs]);

  const flushPending = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => { flushPending.current?.(); }, [scope]);

  useLayoutEffect(() => {
    if (!ready || !userId) return;
    let active = true;
    const gen = persistGen.current;
    const current = () => active && gen === persistGen.current;
    const write = (copy: Workspace) => {
      if (!current()) return;
      const stored = loadWorkspaceForAccount(localStorage, userId, email);
      localStorage.setItem(accountWorkspaceKey(userId), JSON.stringify(reconcileStoredRecords(copy, stored)));
    };
    const failure = () => {
      if (current()) setSaveError("This browser could not save the latest workspace. Its previous copy was kept.");
    };
    const flush = () => {
      try {
        // pagehide has no async lifetime guarantee. New images stay inline until IndexedDB commits.
        write(scope.checkpoint.snapshot(ws));
      } catch { failure(); }
    };
    const id = window.setTimeout(() => {
      void scope.checkpoint.compact(ws, scope.images).then(write).catch(failure);
    }, 250);
    flushPending.current = flush;
    window.addEventListener("pagehide", flush);
    return () => {
      active = false;
      flushPending.current = null;
      window.clearTimeout(id);
      window.removeEventListener("pagehide", flush);
    };
  }, [ready, ws, userId, email, scope]);

  useEffect(() => {
    if (!ready || !userId || !followServer.current) return;
    const gen = persistGen.current;
    const packed = JSON.stringify(ws);
    if (!pendingWrites.current && packed === savedJson.current) return;
    const id = window.setTimeout(() => {
      void saveForOwner(ws, gen)
        .then((result) => {
          if (gen !== persistGen.current) return;
          const message = saveFailureMessage(result);
          if (!message) {
            savedJson.current = packed;
            setSaveError(null);
            return;
          }
          setSaveError(message);
          setSyncNote(message);
        })
        .catch(() => {
          if (gen !== persistGen.current) return;
          const message = saveFailureMessage({ ok: false }) ?? SAVE_FAIL;
          setSaveError(message);
          setSyncNote(message);
        });
    }, 1500);
    return () => window.clearTimeout(id);
  }, [ready, ws, userId, saveForOwner]);

  async function publishServerCopy() {
    if (!ready || !userId || activeScope.current !== scope) return { ok: false as const, error: "Wait for the account workspace to load." };
    const current = latest.current;
    const gen = persistGen.current;
    try {
      const result = await saveForOwner(current, gen);
      if (gen !== persistGen.current) return { ok: false as const, error: "The workspace changed during the save." };
      const message = saveFailureMessage(result);
      if (!message) {
        followServer.current = true;
        savedJson.current = JSON.stringify(current);
        setServerHeld(false);
        setSaveError(null);
        setSyncNote("This browser copy replaced the server copy. It is still not cloud backup.");
        return result;
      }
      setSaveError(message);
      return { ok: false as const, error: message };
    } catch {
      const message = saveFailureMessage({ ok: false }) ?? SAVE_FAIL;
      if (gen === persistGen.current) setSaveError(message);
      return { ok: false as const, error: message };
    }
  }

  /** Retries ONLY the persistence write. Does not call a model. Preserves current workspace content. */
  async function retrySave() {
    return publishServerCopy();
  }

  function clearSaveError() {
    setSaveError(null);
  }

  async function clearStoredCopy(next: Workspace): Promise<boolean> {
    if (!ready || !userId || activeScope.current !== scope) return false;
    const gen = ++persistGen.current;
    latest.current = next;
    if (userId) {
      const packed = JSON.stringify(next);
      localStorage.setItem(accountWorkspaceKey(userId), packed);
    }
    setWs(next);
    try {
      scope.images.clear();
    } catch {
      // The browser has already cleared the owner's snapshot references.
    }
    try {
      const result = await saveForOwner(next, gen);
      if (gen !== persistGen.current) return false;
      const message = saveFailureMessage(result);
      if (!message) {
        followServer.current = true;
        savedJson.current = JSON.stringify(next);
        setServerHeld(false);
        setSaveError(null);
        setSyncNote("This browser copy was cleared. The server copy of these records was replaced. The sign-in account was not deleted.");
        return true;
      }
      setSaveError(message);
      setSyncNote("This browser copy was cleared. The server copy was not replaced. The sign-in account was not deleted.");
      return false;
    } catch {
      if (gen !== persistGen.current) return false;
      const message = saveFailureMessage({ ok: false }) ?? SAVE_FAIL;
      setSaveError(message);
      setSyncNote("This browser copy was cleared. The server copy was not replaced. The sign-in account was not deleted.");
      return false;
    }
  }

  return { ws, ready, setWs, syncNote, serverHeld, publishServerCopy, saveError, retrySave, clearSaveError, clearStoredCopy };
}
