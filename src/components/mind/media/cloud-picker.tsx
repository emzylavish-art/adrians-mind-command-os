import { useEffect, useRef, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import type { CloudConnectionPublic, CloudFileItem, CloudSource } from "@/lib/mind/media/cloud/types";

export type CloudPickerAttach =
  | { kind: "image"; dataUrl: string; name: string; mime?: string }
  | { kind: "text"; name: string; text: string };

type Props = {
  open: boolean;
  purpose?: "chat" | "library";
  onClose: () => void;
  onAttach: (item: CloudPickerAttach) => void;
  onNotice?: (message: string) => void;
};

function apiPrefix() {
  if (typeof window === "undefined") return "";
  return previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
}

function authHeaders(): HeadersInit {
  const token = getBearerToken();
  return {
    "content-type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function CloudPicker({ open, onClose, onAttach, onNotice, purpose = "chat" }: Props) {
  const requestEpoch = useRef(0);
  const isOpen = useRef(open);
  isOpen.current = open;
  const [sources, setSources] = useState<CloudConnectionPublic[]>([]);
  const [source, setSource] = useState<CloudSource>("google_drive");
  const [files, setFiles] = useState<CloudFileItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setFiles([]);
    (async () => {
      try {
        const res = await fetch(`${apiPrefix()}/api/mind/media/cloud/status`, {
          credentials: "same-origin",
          headers: authHeaders(),
        });
        const body = (await res.json()) as { ok?: boolean; sources?: CloudConnectionPublic[]; error?: string };
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          setError(body.error || "Could not read cloud connection status.");
          return;
        }
        setSources(body.sources ?? []);
      } catch {
        if (!cancelled) setError("Could not read cloud connection status.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => { requestEpoch.current++; setBusy(false); setLoadingList(false); return () => { requestEpoch.current++; }; }, [open, source, purpose]);

  const current = sources.find((row) => row.source === source) ?? null;
  const connected = current?.state === "connected";

  async function loadList() {
    const epoch = ++requestEpoch.current;
    setLoadingList(true);
    setError(null);
    setFiles([]);
    try {
      const res = await fetch(`${apiPrefix()}/api/mind/media/cloud/list?source=${encodeURIComponent(source)}`, {
        credentials: "same-origin",
        headers: authHeaders(),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        files?: CloudFileItem[];
        error?: string;
      };
      if (epoch !== requestEpoch.current || !isOpen.current) return;
      if (!res.ok || !body.ok) {
        setError(body.error || "Could not list cloud files.");
        return;
      }
      setFiles(body.files ?? []);
      if ((body.files ?? []).length === 0) setError("No files were returned from this cloud source.");
    } catch {
      if (epoch === requestEpoch.current && isOpen.current) setError("Could not list cloud files.");
    } finally {
      if (epoch === requestEpoch.current) setLoadingList(false);
    }
  }

  async function pick(file: CloudFileItem) {
    const epoch = ++requestEpoch.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiPrefix()}/api/mind/media/cloud/fetch`, {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(),
        body: JSON.stringify({
          source: file.source,
          fileId: file.id,
          name: file.name,
          mimeType: file.mimeType,
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        kind?: "image" | "text";
        dataUrl?: string;
        name?: string;
        mime?: string;
        text?: string;
        error?: string;
      };
      if (epoch !== requestEpoch.current || !isOpen.current) return;
      if (!res.ok || !body.ok) {
        setError(body.error || "Could not download that file.");
        return;
      }
      if (body.kind === "image" && purpose === "library") { setError("Library saves text copies. Choose a text file, or attach this image from Chat."); return; }
      if (body.kind === "image" && body.dataUrl && body.name) {
        onAttach({ kind: "image", dataUrl: body.dataUrl, name: body.name, mime: body.mime });
        onNotice?.(`Attached “${body.name}” from Google Drive.`);
        onClose();
        return;
      }
      if (body.kind === "text" && body.name && typeof body.text === "string") {
        onAttach({ kind: "text", name: body.name, text: body.text });
        if (purpose === "chat") onNotice?.(`Staged text from “${body.name}”. Send includes it.`);
        onClose();
        return;
      }
      setError("That cloud file type is not supported for attach.");
    } catch {
      if (epoch === requestEpoch.current && isOpen.current) setError("Could not download that file.");
    } finally {
      if (epoch === requestEpoch.current) setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Cloud files">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-panel border border-line bg-surface p-4">
        <h3 className="font-display text-xl font-bold">Cloud files</h3>
        <p className="mt-1 text-sm text-muted">{purpose === "library" ? "Choose a text file to save in the selected Library destination." : "Choose a file to attach to this conversation."}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={`min-h-11 rounded-panel px-3 text-sm ${source === "google_drive" ? "bg-accent text-accent-ink" : "border border-line"}`}
            onClick={() => {
              setSource("google_drive");
              setFiles([]);
              setError(null);
            }}
          >
            Google Drive
          </button>
          <button
            type="button"
            className={`min-h-11 rounded-panel px-3 text-sm ${source === "onedrive" ? "bg-accent text-accent-ink" : "border border-line"}`}
            onClick={() => {
              setSource("onedrive");
              setFiles([]);
              setError(null);
            }}
          >
            OneDrive
          </button>
        </div>
        {current && (
          <p className="mt-2 text-xs text-muted">
            Status: <span className="font-semibold">{current.state}</span> — {current.detail}
          </p>
        )}
        {!connected && (
          <p className="mt-3 text-sm text-danger">
            {current?.detail || "Not connected."} Use ServiceBoard → Setup/Connect for this source.
          </p>
        )}
        {connected && (
          <div className="mt-3 flex gap-2">
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={loadingList || busy} onClick={() => void loadList()}>
              {loadingList ? "Listing…" : "List files"}
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-auto text-sm">
          {files.map((file) => (
            <li key={file.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-panel border border-line px-3 text-left disabled:opacity-50"
                disabled={busy}
                onClick={() => void pick(file)}
              >
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-xs text-muted">{file.mimeType}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <button type="button" className="min-h-11 flex-1 rounded-panel border border-line" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
