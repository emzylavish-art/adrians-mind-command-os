import { useEffect, useRef, useState } from "react";
import { compactWorkspaceImages, createIndexedDbBlobStore, hydrateWorkspaceImages } from "./media/blob-store";
import { loadMindCopy, saveMindCopy } from "./server";
import { chooseServerSync } from "./sync";
import type { Workspace } from "./types";
import { emptyWorkspace, loadWorkspace, WORKSPACE_KEY } from "./workspace";
import { SAVE_FAIL, saveFailureMessage } from "./save-error";

function hasContent(ws: Workspace) {
  return ws.chats.length + ws.memories.length + ws.projects.length + ws.files.length + ws.audit.length + ws.agents.length > 0;
}

function mergeStoredAgents(ws: Workspace, stored: Workspace): Workspace {
  const missing = stored.agents.filter((agent) => !ws.agents.some((item) => item.id === agent.id));
  return missing.length > 0 ? { ...ws, agents: [...ws.agents, ...missing] } : ws;
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
      local = mergeStoredAgents(local, localRaw);
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
          setWs(mergeStoredAgents(serverWs, localRaw));
          setSyncNote("Loaded the server copy because this browser was empty. It is still not cloud backup.");
          return;
        }
        if (choice === "upload-local") {
          followServer.current = true;
          savedJson.current = JSON.stringify(local);
          void saveMindCopy({ data: { workspace: local } }).then((saved) => {
            const message = saveFailureMessage(saved);
            if (message) setSaveError(message);
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
        const stored = loadWorkspace(localStorage);
        const missingAgents = stored.agents.filter((agent) => !persisted.agents.some((item) => item.id === agent.id));
        if (missingAgents.length > 0) persisted = { ...persisted, agents: [...persisted.agents, ...missingAgents] };
        try {
          persisted = (await compactWorkspaceImages(persisted, blobStore.current)) as Workspace;
        } catch {
          persisted = persisted;
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
        setSyncNote("This browser copy replaced the server copy. It is still not cloud backup.");
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

  return { ws, ready, setWs, syncNote, serverHeld, publishServerCopy, saveError, retrySave, clearSaveError };
}
