import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { accountImageStore } from "./media/blob-store";
import { clearAccountDrafts } from "./use-composer-draft";
import { createWorkspaceCheckpoint } from "./workspace-checkpoint";
import { loadMindCopy, saveMindCopy, loadAccountAttachment, saveAccountAttachment } from "./server";
import { synchronizeWorkspace } from "./sync";
import { prepareAccountAttachments } from "./media/attachment-integrity";
import type { Workspace } from "./types";
import { accountWorkspaceKey, emptyWorkspace, mergeMemoryState, loadWorkspaceForAccount, normalizeWorkspace, isPrimaryOwner, canonical } from "./workspace";
import { mergeWorkspaceEdits, reconcileWorkspace, type WorkspaceConflict } from "./workspace-edits";
import { SAVE_FAIL, saveFailureMessage } from "./save-error";

function hasContent(ws: Workspace) {
  return ws.chats.length + ws.memories.length + ws.projects.length + ws.files.length + (ws.deletedMemoryIds?.length ?? 0) + ws.audit.length + ws.agents.length > 0;
}

function reconcileStoredRecords(ws: Workspace, stored: Workspace): Workspace {
  const missing = stored.agents.filter((agent) => !ws.agents.some((item) => item.id === agent.id));
  return { ...ws, ...mergeMemoryState(ws, stored), agents: [...ws.agents, ...missing] };
}


export function useMindWorkspace(userId: string | null = "dev-user", email: string | null = null, authLoading = false) {
  const scope = useMemo(() => {
    const empty = emptyWorkspace();
    return { userId, checkpoint: createWorkspaceCheckpoint(), images: accountImageStore(userId, async (id) => {
      if (!userId) return undefined;
      const result = await loadAccountAttachment({ data: { ownerId: userId, id } });
      return result.ok ? result.dataUrl : undefined;
    }), empty, browserBase: empty, serverBase: null as Workspace | null, serverRevision: null as string | null,
      attachmentReceipts: new Map<string, string>(), storageGeneration: 0, review: null as { revision: string; local: string } | null };
    // Email controls legacy ownership; auth transitions invalidate this scope's
    // async hydration/saves even when the user ID has not changed yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, email, authLoading]);
  const [loaded, setLoaded] = useState<{ scope: typeof scope; workspace: Workspace } | null>(null);
  const ready = !authLoading && loaded?.scope === scope;
  const ws = ready ? loaded.workspace : scope.empty;
  const setWs = useCallback((action: SetStateAction<Workspace>) => {
    setLoaded((current) => current?.scope === scope
      ? { scope, workspace: typeof action === "function" ? action(current.workspace) : action }
      : current);
  }, [scope]);
  const [syncNote, setSyncNote] = useState("Browser copy. Server copy has not been checked.");
  const [serverHeld, setServerHeld] = useState(false);
  const [syncConflicts, setSyncConflicts] = useState<WorkspaceConflict[]>([]);
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
  const saveForOwner = useCallback((workspace: Workspace, gen: number, preference?: "local" | "server") => {
    // The base travels with its local edits, not with whichever request finishes last.
    const base = scope.serverBase;
    pendingWrites.current++;
    const result = writeQueue.current.then(async () => {
      const current = () => !authLoading && Boolean(userId) && activeScope.current === scope && gen === persistGen.current;
      if (!current() || !userId) return { ok: false as const, error: "The account workspace changed before saving." };
      const prepared = await prepareAccountAttachments(workspace, async (dataUrl) => {
        if (!current()) return { ok: false as const, error: "The account changed before saving an image." };
        return saveAccountAttachment({ data: { ownerId: userId, dataUrl } });
      }, scope.attachmentReceipts);
      if (!prepared.ok) return prepared;
      const resolution = preference && scope.review?.local === canonical(prepared.workspace)
        ? { preference, revision: scope.review.revision } : undefined;
      const saved = await synchronizeWorkspace({
        local: prepared.workspace, base, current, resolution,
        load: () => loadMindCopy({ data: { ownerId: userId } }),
        save: (candidate, revision) => saveMindCopy({ data: { workspace: candidate, ownerId: userId, expectedRevision: revision } }),
      });
      if (!current()) return { ok: false as const, error: "The account workspace changed during saving." };
      if (saved.ok) {
        scope.serverRevision = saved.revision;
        scope.serverBase = saved.workspace;
        scope.review = null;
        setSyncConflicts([]);
        try { localStorage.setItem(`${accountWorkspaceKey(userId)}.server-base`, JSON.stringify(saved.workspace)); } catch { /* Reload uses conservative reconciliation if the base cannot be retained. */ }
        const hydrated = await scope.checkpoint.hydrate(saved.workspace, scope.images);
        if (!current()) return { ok: false as const, error: "The account changed while restoring image references." };
        const inFlightEdits = reconcileWorkspace(hydrated, workspace, latest.current);
        if (inFlightEdits.conflicts.length) {
          scope.serverBase = prepared.workspace;
          try { localStorage.setItem(`${accountWorkspaceKey(userId)}.server-base`, JSON.stringify(prepared.workspace)); } catch { /* Preserve in-memory comparison base. */ }
          followServer.current = false;
          setServerHeld(true);
          setSyncConflicts(inFlightEdits.conflicts);
          return { ok: false as const, error: "The previous device copy was saved, but newer device edits conflict with the server response. Your newer edits were kept. Retry save to review both copies." };
        }
        setServerHeld(false);
        setSaveError(null);
        setWs((now) => {
          const reconciled = reconcileWorkspace(hydrated, workspace, now);
          if (reconciled.conflicts.length) {
            // Edits made while this request was in flight must not be erased by
            // a remote deletion or conflicting rename received in its response.
            scope.serverBase = prepared.workspace;
            try { localStorage.setItem(`${accountWorkspaceKey(userId)}.server-base`, JSON.stringify(prepared.workspace)); } catch { /* Preserve in-memory comparison base. */ }
            followServer.current = false;
            setServerHeld(true);
            setSyncConflicts(reconciled.conflicts);
            setSaveError("The server saved, but newer device edits conflict with its response. Your device edits were kept. Retry save to review both copies.");
            return now;
          }
          const next = reconciled.workspace;
          if (canonical(next) === canonical(now)) { savedJson.current = JSON.stringify(now); return now; }
          savedJson.current = JSON.stringify(hydrated);
          return next;
        });
        return saved;
      }
      followServer.current = false;
      setServerHeld(true);
      setSyncConflicts(saved.conflicts ?? []);
      scope.review = saved.reviewRevision ? { revision: saved.reviewRevision, local: canonical(prepared.workspace) } : null;
      return saved;
    });
    writeQueue.current = result.then(() => {}, () => {}).finally(() => { pendingWrites.current--; });
    return result;
  }, [scope, userId, authLoading, setWs]);

  useEffect(() => {
    if (authLoading) return;
    let cancel = false;
    const loadGen = ++persistGen.current;
    followServer.current = false;
    savedJson.current = null;
    setServerHeld(false);
    setSyncConflicts([]);
    setSaveError(null);
    setSyncNote("Browser copy. Server copy has not been checked.");
    void (async () => {
      let localRaw = emptyWorkspace();
      try {
        if (userId) {
          localRaw = loadWorkspaceForAccount(localStorage, userId, email);
          const base = localStorage.getItem(`${accountWorkspaceKey(userId)}.server-base`);
          if (base) scope.serverBase = normalizeWorkspace(JSON.parse(base));
          // Only the verified original owner may migrate references from the old shared database.
          if (isPrimaryOwner(email)) scope.images.allowOwnedLegacyReferences(localRaw.chats.flatMap((chat) =>
            chat.messages.flatMap((message) => (message.images ?? []).flatMap((image) => image.blobId ? [image.blobId] : []))));
        }
      } catch {
        setSaveError("This browser could not read its saved workspace.");
        return;
      }
      let local = localRaw;
      try { local = await scope.checkpoint.hydrate(localRaw, scope.images); } catch { /* Preserve missing-image metadata. */ }
      if (cancel || loadGen !== persistGen.current) return;
      scope.browserBase = localRaw;
      local = reconcileStoredRecords(local, localRaw);
      setLoaded({ scope, workspace: local });
      if (!userId) return;
      try {
        const result = await loadMindCopy({ data: { ownerId: userId } });
        if (cancel || loadGen !== persistGen.current) return;
        if (!result.ok) {
          setSyncNote("Browser copy only. The server copy was not read. Nothing was deleted.");
          return;
        }
        scope.serverRevision = result.revision;
        const browser = latest.current === scope.empty ? local : latest.current;
        if (!hasContent(browser)) {
          const remote = result.workspace ?? emptyWorkspace();
          const hydrated = await scope.checkpoint.hydrate(remote, scope.images);
          if (cancel || loadGen !== persistGen.current) return;
          // Input created during the read remains local and is reconciled on its next save.
          if (latest.current !== scope.empty && hasContent(latest.current)) {
            const saved = await saveForOwner(latest.current, loadGen);
            if (cancel || loadGen !== persistGen.current) return;
            if (!saved.ok) { setSaveError(saved.error); setSyncNote(saved.error); return; }
          } else {
            scope.serverBase = remote;
            setWs(hydrated);
            savedJson.current = JSON.stringify(hydrated);
            try { localStorage.setItem(`${accountWorkspaceKey(userId)}.server-base`, JSON.stringify(remote)); } catch { /* Kept in memory. */ }
          }
          followServer.current = true;
          setSyncNote("The account workspace was loaded. Image availability is checked separately.");
          return;
        }
        const saved = await saveForOwner(browser, loadGen);
        if (cancel || loadGen !== persistGen.current) return;
        if (!saved.ok) { setSaveError(saved.error); setSyncNote(saved.error); return; }
        followServer.current = true;
        setSyncNote("Device and server changes were reconciled and saved. This is not an independent backup.");
      } catch {
        if (cancel || loadGen !== persistGen.current) return;
        followServer.current = false;
        setSyncNote("Browser copy only. Sign in may be required before a server copy can be saved.");
      }
    })();
    return () => { cancel = true; ++persistGen.current; };
  }, [userId, email, authLoading, scope, setWs, saveForOwner]);

  useEffect(() => {
    if (!ready || !userId) return;
    const reconcile = (event: StorageEvent) => {
      if (event.key !== accountWorkspaceKey(userId) || event.storageArea !== localStorage) return;
      const stored = loadWorkspaceForAccount(localStorage, userId, email);
      const base = scope.browserBase;
      const gen = persistGen.current;
      const storageGen = ++scope.storageGeneration;
      void scope.checkpoint.hydrate(stored, scope.images).then((hydrated) => {
        if (gen !== persistGen.current || activeScope.current !== scope || storageGen !== scope.storageGeneration) return;
        setWs((current) => {
          const next = mergeWorkspaceEdits(hydrated, base, current);
          scope.browserBase = stored;
          return canonical(next) === canonical(current) ? current : next;
        });
      }).catch(() => { setSaveError("Changes from another tab could not be read. This tab's workspace was kept."); });
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
      localStorage.setItem(accountWorkspaceKey(userId), JSON.stringify(mergeWorkspaceEdits(stored, scope.browserBase, copy)));
      scope.browserBase = copy;
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

  async function publishServerCopy(preference?: "local" | "server") {
    if (!ready || !userId || activeScope.current !== scope) return { ok: false as const, error: "Wait for the account workspace to load." };
    const current = latest.current;
    const gen = persistGen.current;
    try {
      const result = await saveForOwner(current, gen, preference);
      if (gen !== persistGen.current) return { ok: false as const, error: "The workspace changed during the save." };
      const message = saveFailureMessage(result);
      if (!message) {
        followServer.current = true;
        setServerHeld(false);
        setSaveError(null);
        setSyncNote("Device and server changes were reconciled and saved. This is not an independent backup.");
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

  async function resolveSyncConflicts(preference: "local" | "server") {
    return publishServerCopy(preference);
  }

  function clearSaveError() {
    setSaveError(null);
  }

  async function clearStoredCopy(next: Workspace): Promise<string> {
    if (!ready || !userId || activeScope.current !== scope) return "The account changed or is still loading. Reopen Settings and try again.";
    try {
      localStorage.setItem(accountWorkspaceKey(userId), JSON.stringify(next));
      localStorage.removeItem(`${accountWorkspaceKey(userId)}.server-base`);
    } catch {
      return "This browser blocked the storage change. Its workspace was kept.";
    }
    ++persistGen.current;
    followServer.current = false;
    scope.browserBase = next;
    scope.serverBase = null;
    scope.review = null;
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

  return { ws, ready, setWs, syncNote, serverHeld, syncConflicts, resolveSyncConflicts, publishServerCopy, saveError, retrySave, clearSaveError, clearStoredCopy };
}
