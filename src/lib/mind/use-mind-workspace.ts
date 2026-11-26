import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { accountImageStore } from "./media/blob-store";
import { clearAccountDrafts } from "./use-composer-draft";
import { createWorkspaceCheckpoint } from "./workspace-checkpoint";
import { loadMindCopy, saveMindCopy } from "./server";
import { chooseServerSync, reconcileServerWorkspace, serverCheckpointKey } from "./sync";
import type { Workspace } from "./types";
import { accountWorkspaceKey, canonical, emptyWorkspace, mergeMemoryState, loadWorkspaceForAccount, normalizeWorkspace } from "./workspace";
import { mergeWorkspaceEdits, resolveWorkspaceConflict } from "./workspace-edits";
import { applyWorkspaceDelta, createWorkspaceDelta, deltaIsEmpty, splitWorkspaceDelta } from "./workspace-delta";
import { SAVE_FAIL, saveFailureMessage } from "./save-error";

function hasContent(ws: Workspace) {
  return ws.chats.length + ws.memories.length + ws.projects.length + ws.files.length + (ws.deletedMemoryIds?.length ?? 0) + ws.audit.length + ws.agents.length > 0;
}

function reconcileStoredRecords(ws: Workspace, stored: Workspace): Workspace {
  const missing = stored.agents.filter((agent) => !ws.agents.some((item) => item.id === agent.id));
  return { ...ws, ...mergeMemoryState(ws, stored), agents: [...ws.agents, ...missing] };
}


export function useMindWorkspace(userId: string | null = "dev-user", email: string | null = null) {
  const scope = useMemo(() => {
    const empty = emptyWorkspace();
    return { userId, checkpoint: createWorkspaceCheckpoint(), images: accountImageStore(userId), empty, browserBase: empty, serverRevision: null as string | null, serverBase: null as Workspace | null, reconcileGeneration: 0 };
  }, [userId, email]);
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
      if (!scope.serverRevision) return { ok: false as const, error: "Load the server copy before saving it. The browser copy was kept." };
      const compact = await scope.checkpoint.compact(workspace, scope.images);
      if (activeScope.current !== scope || gen !== persistGen.current) return { ok: false as const, error: "The account changed before saving. No workspace was sent." };
      const changes = scope.serverBase ? createWorkspaceDelta(scope.serverBase, compact) : null;
      if (changes && deltaIsEmpty(changes)) return { ok: true as const, revision: scope.serverRevision, storage: "local-server" as const };
      const batches = changes ? splitWorkspaceDelta(changes) : [null];
      let result: Awaited<ReturnType<typeof saveMindCopy>> | undefined;
      for (const batch of batches) {
        if (activeScope.current !== scope || gen !== persistGen.current) return { ok: false as const, error: "The account changed. Confirmed batches were saved; unsent changes remain in the browser copy." };
        result = await saveMindCopy({ data: { ...(batch ? { changes: batch } : { workspace: compact }), ownerId: userId, expectedRevision: scope.serverRevision } });
        if (!result.ok) break;
        scope.serverRevision = result.revision;
        scope.serverBase = batch ? applyWorkspaceDelta(scope.serverBase ?? emptyWorkspace(), batch) : compact;
        try { localStorage.setItem(serverCheckpointKey(userId), JSON.stringify({ revision: result.revision, workspace: scope.serverBase })); }
        catch { if (activeScope.current === scope) setSaveError("The account save succeeded, but this browser could not retain its synchronization checkpoint. Review divergent copies after reopening."); }
      }
      if (!result) return { ok: true as const, revision: scope.serverRevision, storage: "local-server" as const };
      if (!result.ok && "conflict" in result && result.conflict && activeScope.current === scope && gen === persistGen.current) {
        const fresh = await loadMindCopy({ data: { ownerId: userId } });
        if (fresh.ok && fresh.workspace && activeScope.current === scope && gen === persistGen.current) {
          const captured = latest.current;
          const merged = reconcileServerWorkspace(scope.checkpoint.snapshot(captured), fresh.workspace as Workspace, scope.serverBase);
          const hydrated = await scope.checkpoint.hydrate(merged.workspace, scope.images) as Workspace;
          if (activeScope.current !== scope || gen !== persistGen.current) return result;
          scope.serverRevision = fresh.revision;
          scope.serverBase = fresh.workspace as Workspace;
          setWs((current) => mergeWorkspaceEdits(hydrated, captured, current));
          followServer.current = !merged.needsReview;
          setServerHeld(merged.needsReview);
          setSyncNote(merged.needsReview ? "Both versions of conflicting records were kept for review." : "Independent account changes were reconciled. Saving the combined copy next.");
        } else {
          followServer.current = false;
          setServerHeld(true);
        }
      }
      return result;
    });
    writeQueue.current = result.then(() => {}, () => {}).finally(() => { pendingWrites.current--; });
    return result;
  }, [scope, userId, setWs]);

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
      scope.browserBase = localRaw;
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
        scope.serverRevision = result.revision;
        scope.serverBase = result.workspace ? result.workspace as Workspace : emptyWorkspace();
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
        if (choice === "keep-local" && result.workspace) {
          let common: Workspace | null = null;
          try {
            const saved = JSON.parse(localStorage.getItem(serverCheckpointKey(userId)) ?? "null");
            if (saved && typeof saved.revision === "string" && saved.workspace) common = normalizeWorkspace(saved.workspace);
          } catch { /* Without an ancestor, differences require explicit review. */ }
          const captured = latest.current === scope.empty ? local : latest.current;
          const reconciled = reconcileServerWorkspace(scope.checkpoint.snapshot(captured), result.workspace as Workspace, common);
          const hydrated = await scope.checkpoint.hydrate(reconciled.workspace, scope.images) as Workspace;
          if (cancel || loadGen !== persistGen.current) return;
          setWs((current) => mergeWorkspaceEdits(hydrated, captured, current));
          followServer.current = !reconciled.needsReview;
          setServerHeld(reconciled.needsReview);
          setSyncNote(reconciled.needsReview
            ? "Both copies were preserved. Review the individual synchronization conflicts before saving."
            : "Independent changes from this device and your account were reconciled.");
          try { localStorage.setItem(serverCheckpointKey(userId), JSON.stringify({ revision: result.revision, workspace: result.workspace })); }
          catch { setSaveError("The browser could not save its synchronization checkpoint. Current work remains in this session."); }
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
      const generation = ++scope.reconcileGeneration;
      const captured = latest.current;
      const stored = loadWorkspaceForAccount(localStorage, userId, email);
      const merged = mergeWorkspaceEdits(stored, scope.browserBase, scope.checkpoint.snapshot(captured));
      void scope.checkpoint.hydrate(merged, scope.images).then((hydrated) => {
        if (activeScope.current !== scope || generation !== scope.reconcileGeneration) return;
        scope.browserBase = stored;
        setWs((current) => {
          const next = mergeWorkspaceEdits(hydrated as Workspace, captured, current);
          return canonical(next) === canonical(current) ? current : next;
        });
        if (merged.syncConflicts?.length) {
          followServer.current = false;
          setServerHeld(true);
          setSyncNote("Another tab changed the same records. Both variants are kept for review.");
        }
      }).catch(() => setSaveError("The other tab's workspace could not be reconciled. Your current copy was kept."));
    };
    window.addEventListener("storage", reconcile);
    return () => window.removeEventListener("storage", reconcile);
  }, [ready, userId, email, scope, setWs]);

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
      const merged = mergeWorkspaceEdits(stored, scope.browserBase, copy);
      localStorage.setItem(accountWorkspaceKey(userId), JSON.stringify(merged));
      scope.browserBase = merged;
      if (canonical(merged) !== canonical(copy)) {
        const generation = ++scope.reconcileGeneration;
        void scope.checkpoint.hydrate(merged, scope.images).then((hydrated) => {
          if (activeScope.current !== scope || generation !== scope.reconcileGeneration) return;
          setWs((current) => mergeWorkspaceEdits(hydrated as Workspace, ws, current));
        }).catch(failure);
      }
      if (merged.syncConflicts?.length) {
        followServer.current = false;
        setServerHeld(true);
        setSyncNote("Conflicting edits were preserved. Review them before synchronizing your account.");
      }
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
      void scope.checkpoint.compact(ws, scope.images).then((copy) => {
        if (!navigator.locks) return write(copy);
        return navigator.locks.request(accountWorkspaceKey(userId), () => write(copy));
      }).catch(failure);
    }, 250);
    flushPending.current = flush;
    window.addEventListener("pagehide", flush);
    return () => {
      active = false;
      flushPending.current = null;
      window.clearTimeout(id);
      window.removeEventListener("pagehide", flush);
    };
  }, [ready, ws, userId, email, scope, setWs]);

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
    if (current.syncConflicts?.length) return { ok: false as const, error: "Review the individual synchronization conflicts before saving. Both variants were kept." };
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

  async function clearStoredCopy(next: Workspace): Promise<string> {
    if (!ready || !userId || activeScope.current !== scope) return "The account changed or is still loading. Reopen Settings and try again.";
    try {
      localStorage.setItem(accountWorkspaceKey(userId), JSON.stringify(next));
    } catch {
      return "This browser blocked the storage change. Its workspace was kept.";
    }
    ++persistGen.current;
    followServer.current = false;
    scope.browserBase = next;
    latest.current = next;
    setWs(next);
    setServerHeld(true);
    setSaveError(null);
    const message = "This device’s workspace was cleared. Your server copy was kept.";
    setSyncNote(message);
    try {
      clearAccountDrafts(userId);
      await scope.images.clear();
      return message;
    } catch {
      return "This device’s workspace was cleared. Draft or image removal is unconfirmed. Close other Mind OS tabs and retry.";
    }
  }

  function resolveSyncConflict(id: string, choice: "local" | "remote") {
    setWs((current) => {
      const next = resolveWorkspaceConflict(current, id, choice);
      if (!next.syncConflicts?.length) {
        followServer.current = true;
        setServerHeld(false);
        setSyncNote("All conflicting records were reviewed. Synchronization can continue.");
      }
      return next;
    });
  }

  /** Save current privacy/data before a new memory-bearing request. Existing receipts may still be recovered without this. */
  async function prepareMemoryDispatch(workspace: Workspace = latest.current) {
    if (workspace.syncConflicts?.length) return { ok: false as const, error: "Review synchronization conflicts before using saved context." };
    if (!ready || !userId || activeScope.current !== scope) return { ok: false as const, error: "Wait for the account workspace to load." };
    try { return await saveForOwner(workspace, persistGen.current); }
    catch { return { ok: false as const, error: "Current conversation privacy could not be saved. Your browser copy was kept; no new model request was sent." }; }
  }

  return { ws, ready, setWs, syncNote, serverHeld, publishServerCopy, saveError, retrySave, clearSaveError, clearStoredCopy, resolveSyncConflict, prepareMemoryDispatch };
}
