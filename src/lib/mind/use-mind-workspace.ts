import { useEffect, useRef, useState } from "react";
import { compactWorkspaceImages, createIndexedDbBlobStore, hydrateWorkspaceImages } from "./media/blob-store";
import { loadMindCopy, saveMindCopy } from "./server";
import { chooseServerSync } from "./sync";
import type { Workspace } from "./types";
import { emptyWorkspace, loadWorkspace, WORKSPACE_KEY } from "./workspace";
import { SAVE_FAIL } from "./save-error";

function hasContent(ws: Workspace) {
  return ws.chats.length + ws.memories.length + ws.projects.length + ws.files.length + ws.audit.length > 0;
}


export function useMindWorkspace() {
  const [ws, setWs] = useState<Workspace>(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [syncNote, setSyncNote] = useState("Browser copy. Server copy has not been checked.");
  const [serverHeld, setServerHeld] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const followServer = useRef(false);
  const savedJson = useRef<string | null>(null);
  const latest = useRef(ws);
  const blobStore = useRef(createIndexedDbBlobStore());
  latest.current = ws;

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const localRaw = loadWorkspace(localStorage);
      let local = localRaw;
      try {
        local = (await hydrateWorkspaceImages(localRaw, blobStore.current)) as Workspace;
      } catch {
        local = localRaw;
      }
      if (cancel) return;
      setWs(local);
      setReady(true);
      try {
        const result = await loadMindCopy();
        if (cancel || !result.ok) {
          followServer.current = false;
          if (!cancel) setSyncNote("Browser copy only. The server copy was not read. Nothing was deleted.");
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
          setSyncNote("Loaded the server copy because this browser was empty. It is still not cloud backup.");
          return;
        }
        if (choice === "upload-local") {
          followServer.current = true;
          savedJson.current = JSON.stringify(local);
          void saveMindCopy({ data: { workspace: local } }).then((saved) => {
            if (!saved.ok) setSaveError(saved.error || SAVE_FAIL);
          });
          setSyncNote("This browser's copy was sent to the local server database. It is not cloud backup.");
          return;
        }
        if (choice === "keep-local") {
          followServer.current = false;
          setServerHeld(true);
          setSyncNote("This browser kept its own copy. The server copy was not overwritten.");
          return;
        }
        followServer.current = true;
        savedJson.current = JSON.stringify(local);
        setSyncNote("Nothing is stored yet. This is not cloud backup.");
      } catch {
        followServer.current = false;
        if (!cancel) setSyncNote("Browser copy only. Sign in may be required before a server copy can be saved.");
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

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
          if (result.ok) {
            savedJson.current = packed;
            return;
          }
          setSyncNote(result.error || "The server copy could not be saved. The browser copy was kept.");
        })
        .catch(() => {
          setSyncNote("The server copy could not be saved. The browser copy was kept.");
        });
    }, 1500);
    return () => window.clearTimeout(id);
  }, [ready, ws]);

  async function publishServerCopy() {
    const current = latest.current;
    try {
      const result = await saveMindCopy({ data: { workspace: current } });
      if (result.ok) {
        followServer.current = true;
        savedJson.current = JSON.stringify(current);
        setServerHeld(false);
        setSaveError(null);
        setSyncNote("This browser copy replaced the server copy. It is still not cloud backup.");
        return result;
      }
      const message = result.error || SAVE_FAIL;
      setSaveError(message);
      return { ok: false as const, error: message };
    } catch {
      setSaveError(SAVE_FAIL);
      return { ok: false as const, error: SAVE_FAIL };
    }
  }

  /** Retries ONLY the persistence write. Does not call a model. Preserves current workspace content. */
  async function retrySave() {
    return publishServerCopy();
  }

  function clearSaveError() {
    setSaveError(null);
  }

  return { ws, ready, setWs, syncNote, serverHeld, publishServerCopy, saveError, retrySave, clearSaveError };
}
