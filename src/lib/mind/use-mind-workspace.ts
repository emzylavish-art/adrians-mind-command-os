import { useEffect, useRef, useState } from "react";
import { compactWorkspaceImages, createIndexedDbBlobStore, hydrateWorkspaceImages } from "./media/blob-store";
import { loadMindCopy, saveMindCopy } from "./server";
import { chooseServerSync, pickInitialWorkspace } from "./sync";
import type { Workspace } from "./types";
import { emptyWorkspace, loadWorkspace, WORKSPACE_KEY } from "./workspace";
import { SAVE_FAIL, saveFailureMessage } from "./save-error";

function hasContent(ws: Workspace) {
  return ws.chats.length + ws.memories.length + ws.projects.length + ws.files.length + ws.audit.length > 0;
}

/** Sync read for instant first paint (no blank emptyWorkspace flash). */
export function readLocalWorkspaceSync(): Workspace {
  if (typeof localStorage === "undefined") return emptyWorkspace();
  try {
    return loadWorkspace(localStorage);
  } catch {
    return emptyWorkspace();
  }
}

export function useMindWorkspace(serverSeed?: Workspace | null) {
  const [ws, setWs] = useState<Workspace>(() => pickInitialWorkspace(readLocalWorkspaceSync(), serverSeed ?? null));
  // Local cache is available synchronously — shell paints with history immediately.
  const [ready, setReady] = useState(true);
  const [syncNote, setSyncNote] = useState("Browser copy. Server copy has not been checked.");
  const [serverHeld, setServerHeld] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cloudHydrating, setCloudHydrating] = useState(true);
  const followServer = useRef(false);
  const savedJson = useRef<string | null>(null);
  const latest = useRef(ws);
  const blobStore = useRef(createIndexedDbBlobStore());
  latest.current = ws;

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const localRaw = readLocalWorkspaceSync();
      let local = localRaw;
      try {
        local = (await hydrateWorkspaceImages(localRaw, blobStore.current)) as Workspace;
      } catch {
        local = localRaw;
      }
      if (cancel) return;
      // Prefer non-empty local; seed from route loader server copy when local empty.
      const seeded = pickInitialWorkspace(local, serverSeed ?? null);
      setWs(seeded);
      setReady(true);
      try {
        const result = await loadMindCopy();
        if (cancel || !result.ok) {
          followServer.current = false;
          if (!cancel) {
            setSyncNote("Browser copy only. The server copy was not read. Nothing was deleted.");
            setCloudHydrating(false);
          }
          return;
        }
        const choice = chooseServerSync(hasContent(local), Boolean(result.workspace && hasContent(result.workspace)));
        if (choice === "use-server" && result.workspace) {
          followServer.current = true;
          let serverWs = result.workspace as Workspace;
          try {
            serverWs = (await hydrateWorkspaceImages(serverWs, blobStore.current)) as Workspace;
          } catch {
            /* keep raw */
          }
          if (cancel) return;
          savedJson.current = JSON.stringify(result.workspace);
          setWs(serverWs);
          setSyncNote("Loaded the cloud workspace copy because this browser was empty.");
          setCloudHydrating(false);
          return;
        }
        if (choice === "upload-local") {
          followServer.current = true;
          savedJson.current = JSON.stringify(local);
          void saveMindCopy({ data: { workspace: local } }).then((saved) => {
            const message = saveFailureMessage(saved);
            if (message) setSaveError(message);
          });
          setSyncNote("This browser's copy was sent to the cloud workspace store.");
          setCloudHydrating(false);
          return;
        }
        if (choice === "keep-local") {
          followServer.current = false;
          setServerHeld(true);
          setSyncNote("This browser kept its own copy. The server copy was not overwritten.");
          setCloudHydrating(false);
          return;
        }
        followServer.current = true;
        savedJson.current = JSON.stringify(local);
        setSyncNote("Nothing is stored yet.");
        setCloudHydrating(false);
      } catch {
        followServer.current = false;
        if (!cancel) {
          setSyncNote("Browser copy only. Sign in may be required before a server copy can be saved.");
          setCloudHydrating(false);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [serverSeed]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const write = () => {
      void (async () => {
        let persisted = ws;
        try {
          persisted = (await compactWorkspaceImages(ws, blobStore.current)) as Workspace;
        } catch {
          persisted = ws;
        }
        if (cancelled) return;
        localStorage.setItem(WORKSPACE_KEY, JSON.stringify(persisted));
      })();
    };
    const id = window.setTimeout(write, 250);
    window.addEventListener("pagehide", write);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
      window.removeEventListener("pagehide", write);
    };
  }, [ready, ws]);

  useEffect(() => {
    if (!ready || !followServer.current) return;
    const packed = JSON.stringify(ws);
    if (packed === savedJson.current) return;
    const id = window.setTimeout(() => {
      void saveMindCopy({ data: { workspace: ws } })
        .then((result) => {
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
          const message = saveFailureMessage({ ok: false }) ?? SAVE_FAIL;
          setSaveError(message);
          setSyncNote(message);
        });
    }, 1500);
    return () => window.clearTimeout(id);
  }, [ready, ws]);

  async function publishServerCopy() {
    const current = latest.current;
    try {
      const result = await saveMindCopy({ data: { workspace: current } });
      const message = saveFailureMessage(result);
      if (!message) {
        followServer.current = true;
        savedJson.current = JSON.stringify(current);
        setServerHeld(false);
        setSaveError(null);
        setSyncNote("This browser copy replaced the cloud workspace copy.");
        return result;
      }
      setSaveError(message);
      return { ok: false as const, error: message };
    } catch {
      const message = saveFailureMessage({ ok: false }) ?? SAVE_FAIL;
      setSaveError(message);
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

  return {
    ws,
    ready,
    setWs,
    syncNote,
    serverHeld,
    publishServerCopy,
    saveError,
    retrySave,
    clearSaveError,
    cloudHydrating,
  };
}
