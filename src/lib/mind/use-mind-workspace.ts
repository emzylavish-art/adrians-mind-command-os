import { useEffect, useRef, useState } from "react";
import { loadMindCopy, saveMindCopy } from "./server";
import { chooseServerSync } from "./sync";
import type { Workspace } from "./types";
import { emptyWorkspace, loadWorkspace, WORKSPACE_KEY } from "./workspace";

function hasContent(ws: Workspace) {
  return ws.chats.length + ws.memories.length + ws.projects.length + ws.files.length + ws.audit.length > 0;
}

const SAVE_FAIL = "The server copy could not be saved. The browser copy was kept.";

export function useMindWorkspace() {
  const [ws, setWs] = useState<Workspace>(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [syncNote, setSyncNote] = useState("Browser copy. Server copy has not been checked.");
  const [serverHeld, setServerHeld] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const followServer = useRef(false);
  const savedJson = useRef<string | null>(null);
  const latest = useRef(ws);
  latest.current = ws;

  useEffect(() => {
    const local = loadWorkspace(localStorage);
    setWs(local);
    setReady(true);
    let cancel = false;
    void loadMindCopy()
      .then((result) => {
        if (cancel || !result.ok) {
          followServer.current = false;
          if (!cancel) setSyncNote("Browser copy only. The server copy was not read. Nothing was deleted.");
          return;
        }
        const choice = chooseServerSync(hasContent(local), Boolean(result.workspace && hasContent(result.workspace)));
        if (choice === "use-server" && result.workspace) {
          followServer.current = true;
          savedJson.current = JSON.stringify(result.workspace);
          setWs(result.workspace);
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
      })
      .catch(() => {
        followServer.current = false;
        if (!cancel) setSyncNote("Browser copy only. Sign in may be required before a server copy can be saved.");
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const write = () => localStorage.setItem(WORKSPACE_KEY, JSON.stringify(ws));
    const id = window.setTimeout(write, 250);
    window.addEventListener("pagehide", write);
    return () => {
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
            setSaveError(null);
            return;
          }
          setSaveError(result.error || SAVE_FAIL);
          setSyncNote(result.error || SAVE_FAIL);
        })
        .catch(() => {
          setSaveError(SAVE_FAIL);
          setSyncNote(SAVE_FAIL);
        });
    }, 1500);
    return () => window.clearTimeout(id);
  }, [ready, ws]);

  async function publishServerCopy() {
    const current = latest.current;
    const result = await saveMindCopy({ data: { workspace: current } });
    if (result.ok) {
      followServer.current = true;
      savedJson.current = JSON.stringify(current);
      setServerHeld(false);
      setSaveError(null);
      setSyncNote("This browser copy replaced the server copy. It is still not cloud backup.");
    } else {
      setSaveError(result.error || SAVE_FAIL);
    }
    return result;
  }

  /** Retries ONLY the persistence write. Does not call a model. Preserves current workspace content. */
  async function retrySave() {
    const current = latest.current;
    const result = await saveMindCopy({ data: { workspace: current } });
    if (result.ok) {
      followServer.current = true;
      savedJson.current = JSON.stringify(current);
      setSaveError(null);
      setSyncNote("This browser copy replaced the server copy. It is still not cloud backup.");
    } else {
      setSaveError(result.error || SAVE_FAIL);
    }
    return result;
  }

  function clearSaveError() {
    setSaveError(null);
  }

  return { ws, ready, setWs, syncNote, serverHeld, publishServerCopy, saveError, retrySave, clearSaveError };
}

/** Pure helper for tests: classify a save result without UI. */
export function saveFailureMessage(result: { ok: true } | { ok: false; error?: string }): string | null {
  if (result.ok) return null;
  return result.error || SAVE_FAIL;
}
