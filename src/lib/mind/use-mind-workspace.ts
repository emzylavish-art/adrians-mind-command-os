import { useEffect, useRef, useState } from "react";
import {
  collectWorkspaceBlobIds,
  compactWorkspaceImagesDetailed,
  createIndexedDbBlobStore,
  gcOrphanMediaBlobs,
  hydrateWorkspaceImages,
  readMediaOwnerScope,
  readPendingGcOrphans,
  writePendingGcOrphans,
} from "./media/blob-store";
import { loadMindCopy, saveMindCopy } from "./server";
import { chooseServerSync } from "./sync";
import type { Workspace } from "./types";
import { emptyWorkspace, loadWorkspaceDetailed, WORKSPACE_KEY } from "./workspace";

function hasContent(ws: Workspace) {
  return ws.chats.length + ws.memories.length + ws.projects.length + ws.files.length + ws.audit.length > 0;
}

export function useMindWorkspace() {
  const [ws, setWs] = useState<Workspace>(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [syncNote, setSyncNote] = useState("Browser copy. Server copy has not been checked.");
  const [serverHeld, setServerHeld] = useState(false);
  const [mediaWarning, setMediaWarning] = useState<string | null>(null);
  const followServer = useRef(false);
  const savedJson = useRef<string | null>(null);
  const latest = useRef(ws);
  const ownerScope = useRef(readMediaOwnerScope());
  const blobStore = useRef(createIndexedDbBlobStore(ownerScope.current));
  /** Skip GC on the load/normalize cycle; arm only after the first persist finishes. */
  const gcLoadCycle = useRef(true);
  const skipGcForSession = useRef(false);
  latest.current = ws;

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const loaded = loadWorkspaceDetailed(localStorage);
      if (loaded.report.unsafeForBlobGc) {
        skipGcForSession.current = true;
      }
      let local = loaded.workspace;
      try {
        local = (await hydrateWorkspaceImages(local, blobStore.current)) as Workspace;
      } catch {
        local = loaded.workspace;
        skipGcForSession.current = true;
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
            skipGcForSession.current = true;
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
          void saveMindCopy({ data: { workspace: local } });
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
          const compacted = await compactWorkspaceImagesDetailed(ws, blobStore.current);
          persisted = compacted.workspace as Workspace;
          if (!cancelled) {
            setMediaWarning(compacted.warning ?? null);
          }
          const live = collectWorkspaceBlobIds(persisted);
          const previous = readPendingGcOrphans();
          const skip = skipGcForSession.current || gcLoadCycle.current;
          const gc = await gcOrphanMediaBlobs(blobStore.current, live, {
            previouslyUnreferenced: previous,
            skip,
          });
          writePendingGcOrphans(gc.candidates);
          if (gcLoadCycle.current) gcLoadCycle.current = false;
        } catch {
          persisted = ws;
          skipGcForSession.current = true;
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
          if (result.ok) savedJson.current = packed;
        })
        .catch(() => undefined);
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
      setSyncNote("This browser copy replaced the server copy. It is still not cloud backup.");
    }
    return result;
  }

  return { ws, ready, setWs, syncNote, serverHeld, publishServerCopy, mediaWarning };
}
