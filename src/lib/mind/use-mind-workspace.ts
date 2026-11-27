import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { accountImageStore } from "./media/blob-store";
import { clearDeviceVideos } from "./media/video-device-store";
import { accountOriginalFileStore } from "./library-documents";
import { accountKnowledgeStore } from "./knowledge-index";
import { clearAccountDrafts } from "./use-composer-draft";
import { createWorkspaceCheckpoint } from "./workspace-checkpoint";
import { loadMindCopy, saveMindChanges, loadAccountAttachment, saveAccountAttachment } from "./server";
import { planWorkspaceChanges, validateWorkspaceChanges } from "./workspace-changes";
import { chooseServerSync } from "./sync";
import { ACCOUNT_ATTACHMENT_ID, prepareAccountAttachments } from "./media/attachment-integrity";
import type { Chat, Workspace } from "./types";
import { accountWorkspaceKey, emptyWorkspace, mergeChatDeletionState, mergeMemoryState, loadWorkspaceForAccount, readWorkspaceRawForAccount, stampWorkspaceEdits } from "./workspace";
import { parseWorkspaceDeferred } from "./workspace-loader";
import { applyWorkspaceImagePatches, createWorkspaceMediaLoader, type WorkspaceMediaProgress } from "./workspace-media-loader";
import { mergeWorkspaceEdits } from "./workspace-edits";
import { SAVE_FAIL, saveFailureMessage } from "./save-error";

function hasContent(ws: Workspace) {
  return ws.chats.length + ws.memories.length + ws.projects.length + ws.files.length + (ws.deletedMemoryIds?.length ?? 0) + (ws.deletedChatIds?.length ?? 0) + ws.audit.length + ws.agents.length > 0;
}

export function useMindWorkspace(userId: string | null = "dev-user", email: string | null = null, authLoading = false) {
  const scope = useMemo(() => {
    const empty = emptyWorkspace();
    const images = accountImageStore(userId, async (id) => {
      if (!userId || !ACCOUNT_ATTACHMENT_ID.test(id)) return undefined;
      const result = await loadAccountAttachment({ data: { ownerId: userId, id } });
      return result.ok ? result.dataUrl : undefined;
    });
    return { userId, checkpoint: createWorkspaceCheckpoint(), images, mediaLoader: createWorkspaceMediaLoader(images), priorityChatId: null as string | null, mediaGeneration: 0, empty, browserBase: empty, acknowledgedClient: empty, serverRevision: null as string | null, attachmentReceipts: new Map<string, string>() };
  }, [userId, email, authLoading]);
  const [loaded, setLoaded] = useState<{ scope: typeof scope; workspace: Workspace } | null>(null);
  const [mediaState, setMediaState] = useState<{ scope: typeof scope; progress: WorkspaceMediaProgress } | null>(null);
  const ready = loaded?.scope === scope;
  const ws = ready ? loaded.workspace : scope.empty;
  const setWs = useCallback((action: SetStateAction<Workspace>) => {
    setLoaded((current) => current?.scope === scope
      ? { scope, workspace: stampWorkspaceEdits(current.workspace, typeof action === "function" ? action(current.workspace) : action) }
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
      const prepared = await prepareAccountAttachments(workspace, async (dataUrl) => {
        if (activeScope.current !== scope || gen !== persistGen.current) return { ok: false, error: "The account changed before saving an attachment." };
        return saveAccountAttachment({ data: { ownerId: userId, dataUrl } });
      }, scope.attachmentReceipts, (id) => scope.images.getOwned(id));
      if (!prepared.ok) return prepared;
      if (activeScope.current !== scope || gen !== persistGen.current) return { ok: false as const, error: "The account changed before saving." };
      const storedWorkspace = prepared.workspace;
      const changes = planWorkspaceChanges(scope.acknowledgedClient, storedWorkspace);
      const checked = validateWorkspaceChanges(changes);
      if (!checked.ok) return checked;
      const result = await saveMindChanges({ data: { changes: checked.changes, ownerId: userId, expectedRevision: scope.serverRevision } });
      if (result.ok) { scope.serverRevision = result.revision; scope.acknowledgedClient = storedWorkspace; }
      else if ("conflict" in result && result.conflict && activeScope.current === scope && gen === persistGen.current) {
        followServer.current = false;
        setServerHeld(true);
      }
      return result;
    });
    writeQueue.current = result.then(() => {}, () => {}).finally(() => { pendingWrites.current--; });
    return result;
  }, [scope, userId]);

  const beginMediaHydration = useCallback((workspace: Workspace, gen: number) => {
    const run = ++scope.mediaGeneration;
    const isCurrent = () => activeScope.current === scope && gen === persistGen.current && run === scope.mediaGeneration;
    void scope.mediaLoader.progressively(workspace, {
      isCurrent,
      priorityChatId: () => scope.priorityChatId,
      onBatch: (patches, progress) => {
        if (!isCurrent()) return;
        setWs((current) => applyWorkspaceImagePatches(current, patches, scope.checkpoint.rememberHydratedImage));
        setMediaState({ scope, progress });
      },
    }).then((progress) => { if (isCurrent()) setMediaState({ scope, progress }); });
  }, [scope, setWs]);

  const ensureChatMedia = useCallback(async (chat: Chat, signal?: AbortSignal): Promise<Chat | null> => {
    const gen = persistGen.current;
    const isCurrent = () => activeScope.current === scope && gen === persistGen.current && !signal?.aborted && !latest.current.deletedChatIds?.includes(chat.id);
    if (!isCurrent()) return null;
    const patches = await scope.mediaLoader.chatPatches(chat, isCurrent);
    if (!isCurrent()) return null;
    setWs((current) => applyWorkspaceImagePatches(current, patches, scope.checkpoint.rememberHydratedImage));
    return applyWorkspaceImagePatches({ ...scope.empty, chats: [chat] }, patches, scope.checkpoint.rememberHydratedImage).chats[0];
  }, [scope, setWs]);

  const prioritizeChatMedia = useCallback((chatId: string | null) => {
    scope.priorityChatId = chatId;
    const chat = latest.current.chats.find((item) => item.id === chatId);
    if (chat) void ensureChatMedia(chat);
  }, [scope, ensureChatMedia]);

  useEffect(() => {
    if (authLoading) return;
    let cancel = false;
    const loading = new AbortController();
    const loadGen = ++persistGen.current;
    followServer.current = false;
    savedJson.current = null;
    setServerHeld(false);
    setSaveError(null);
    setSyncNote("Loading complete workspace records. Saving stays paused until loading finishes.");
    void (async () => {
      let localRaw = emptyWorkspace();
      try {
        if (userId) localRaw = (await parseWorkspaceDeferred(readWorkspaceRawForAccount(localStorage, userId, email), { signal: loading.signal })).workspace;
      } catch (cause) {
        if (cancel || loadGen !== persistGen.current || activeScope.current !== scope) return;
        setSaveError(cause instanceof Error ? cause.message : "This browser could not read its saved workspace. Its stored copy was kept.");
        return;
      }
      if (cancel || loadGen !== persistGen.current || activeScope.current !== scope) return;
      scope.browserBase = localRaw;
      const local = localRaw;
      setLoaded({ scope, workspace: local });
      setSyncNote("Complete workspace records loaded. Historical image copies load separately. The server copy has not been checked.");
      beginMediaHydration(local, loadGen);
      if (!userId) return;
      try {
        const result = await loadMindCopy({ data: { ownerId: userId } });
        if (cancel || loadGen !== persistGen.current || activeScope.current !== scope) return;
        if (!result.ok) {
          followServer.current = false;
          setSyncNote("Browser copy only. The server copy was not read. Nothing was deleted.");
          return;
        }
        scope.serverRevision = result.revision;
        scope.acknowledgedClient = result.workspace ?? emptyWorkspace();
        const browser = latest.current === scope.empty ? local : latest.current;
        const choice = chooseServerSync(hasContent(localRaw), Boolean(result.workspace && hasContent(result.workspace)));
        if (choice === "use-server" && result.workspace) {
          const serverWs = result.workspace as Workspace;
          if (cancel || loadGen !== persistGen.current || activeScope.current !== scope) return;
          const merged = mergeWorkspaceEdits(serverWs, localRaw, browser);
          setWs((current) => mergeWorkspaceEdits(serverWs, localRaw, current));
          beginMediaHydration(merged, loadGen);
          if (merged.syncConflicts?.length) {
            setServerHeld(true);
            setSyncNote("Device and server changes need review. Both copies were kept.");
            return;
          }
          followServer.current = true;
          savedJson.current = JSON.stringify(serverWs);
          if (hasContent(browser)) {
            const saved = await saveForOwner(merged, loadGen);
            if (cancel || activeScope.current !== scope || loadGen !== persistGen.current) return;
            if (!saved.ok) { setSaveError(saved.error); setSyncNote(saved.error); return; }
            savedJson.current = JSON.stringify(scope.checkpoint.snapshot(merged));
          }
          setSyncNote("Loaded the server copy and retained changes made on this device.");
          return;
        }
        if (loadGen !== persistGen.current) return;
        if (choice === "upload-local") {
          followServer.current = true;
          const saved = await saveForOwner(browser, loadGen);
          if (cancel || loadGen !== persistGen.current || activeScope.current !== scope) return;
          const message = saveFailureMessage(saved);
          if (message) {
            setSaveError(message);
            setSyncNote(message);
          } else {
            savedJson.current = JSON.stringify(scope.checkpoint.snapshot(browser));
            setSyncNote("This browser's copy was saved to the local server database. It is not cloud backup.");
          }
          return;
        }
        if (choice === "keep-local") {
          if (result.workspace) {
            const server = result.workspace as Workspace;
            setWs((current) => ({ ...current, ...mergeMemoryState(current, server), ...mergeChatDeletionState(current, server) }));
          }
          followServer.current = false;
          setServerHeld(true);
          setSyncNote("This browser kept its own copy. The server copy was not overwritten.");
          return;
        }
        followServer.current = true;
        savedJson.current = JSON.stringify(scope.checkpoint.snapshot(local));
        setSyncNote("Nothing is stored yet. This is not cloud backup.");
      } catch {
        if (cancel || loadGen !== persistGen.current || activeScope.current !== scope) return;
        followServer.current = false;
        setSyncNote("Browser copy only. Sign in may be required before a server copy can be saved.");
      }
    })();
    return () => {
      cancel = true;
      loading.abort();
      ++persistGen.current;
    };
  }, [userId, email, authLoading, scope, setWs, saveForOwner, beginMediaHydration]);

  useEffect(() => {
    if (!ready || !userId) return;
    const reconcile = (event: StorageEvent) => {
      if (event.key !== accountWorkspaceKey(userId) || event.storageArea !== localStorage) return;
      const stored = loadWorkspaceForAccount(localStorage, userId, email);
      const base = scope.browserBase;
      scope.browserBase = stored;
      setWs((current) => mergeWorkspaceEdits(stored, base, current));
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
    const packed = JSON.stringify(scope.checkpoint.snapshot(ws));
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
  }, [ready, ws, userId, scope, saveForOwner]);

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
        savedJson.current = JSON.stringify(scope.checkpoint.snapshot(current));
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
      await clearDeviceVideos(userId);
      await accountOriginalFileStore(userId).clear();
      await accountKnowledgeStore(userId).clear();
      return message;
    } catch {
      return "This device’s workspace was cleared. Draft, image, video, original document, or local knowledge removal is unconfirmed. Close other Mind OS tabs and retry.";
    }
  }

  return { ws, ready, setWs, syncNote, serverHeld, publishServerCopy, saveError, retrySave, clearSaveError, clearStoredCopy, ensureChatMedia, prioritizeChatMedia, mediaProgress: mediaState?.scope === scope ? mediaState.progress : null };
}
