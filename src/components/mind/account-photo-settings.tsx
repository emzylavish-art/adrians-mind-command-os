import { useCallback, useEffect, useRef, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import { accountPhotoData, type AccountPhoto } from "@/lib/mind/account-photo";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

async function requestPhoto(owner: string, signal: AbortSignal, changes?: AccountPhoto) {
  const prefix = previewPathPrefix(location.hostname, location.pathname) ?? "";
  const path = prefix + "/api/mind/account-photo";
  const headers = new Headers();
  const token = getBearerToken();
  if (token) headers.set("authorization", "Bearer " + token);
  if (changes) headers.set("content-type", "application/json");
  const response = await fetch(changes ? path : path + "?" + new URLSearchParams({ owner }), {
    headers, credentials: "same-origin", cache: "no-store", signal,
    method: changes ? "POST" : "GET",
    body: changes && JSON.stringify({ owner, ...changes }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw Error(data?.error || "The account photo could not be confirmed.");
  return data as AccountPhoto;
}

export function useAccountPhoto(owner: string | null) {
  const [photo, setPhoto] = useState<AccountPhoto | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const active = useRef<AbortController | null>(null);
  const request = useCallback(async (changes?: AccountPhoto) => {
    if (!owner || active.current) return false;
    const controller = new AbortController();
    active.current = controller;
    setWorking(true);
    setMessage("");
    try {
      const saved = await requestPhoto(owner, controller.signal, changes);
      if (controller.signal.aborted) return false;
      setPhoto(saved);
      if (changes) setMessage(saved.dataUrl ? "Account photo saved." : "Account photo removed.");
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        setPhoto(null);
        setMessage(error instanceof Error ? error.message : "The account photo could not be confirmed.");
      }
      return false;
    } finally {
      if (active.current === controller) {
        active.current = null;
        setWorking(false);
      }
    }
  }, [owner]);

  useEffect(() => {
    setPhoto(null);
    void request();
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [request]);

  return { photo, message, working, request };
}

const button = "min-h-11 rounded-panel border border-line px-3 text-sm";

export function AccountPhotoSettings({ state }: { state: ReturnType<typeof useAccountPhoto> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [draftRevision, setDraftRevision] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const selected = useRef(0);
  const { photo, message, working, request } = state;
  const stale = !!draft && !!photo && photo.revision !== draftRevision;

  async function choose(file?: File) {
    if (!file || !photo) return;
    const id = ++selected.current;
    const revision = photo.revision;
    setReading(true);
    setError("");
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
        throw Error("Choose a JPEG, PNG or WebP up to 10 MB.");
      }
      const { fileToDownscaledDataUrl } = await import("./media/downscale");
      const { dataUrl } = await fileToDownscaledDataUrl(file, 160);
      if (!accountPhotoData(dataUrl)) throw Error("That photo is too large after compression. Choose a smaller image.");
      if (selected.current === id) {
        setDraft(dataUrl);
        setDraftRevision(revision);
      }
    } catch (err) {
      if (selected.current === id) setError(err instanceof Error ? err.message : "The photo could not be read.");
    } finally {
      if (selected.current === id) setReading(false);
    }
  }

  async function save(dataUrl: string | null) {
    if (!photo || (dataUrl !== null && stale)) return;
    if (await request({ dataUrl, revision: dataUrl === null ? photo.revision : draftRevision })) {
      setDraft(null);
      setError("");
    }
  }

  return <section className="space-y-2 rounded-panel border border-line p-4" aria-label="Account photo">
    <h3 className="font-semibold">Account photo</h3>
    <p className="text-sm text-muted">This photo appears when you sign in to this account on another device.</p>
    {draft && <img className="size-16 rounded-full object-cover" src={draft} alt="Account photo preview" />}
    <label className="grid gap-1 text-sm">Choose an account photo
      <input type="file" disabled={!photo || working} accept="image/jpeg,image/png,image/webp"
        onChange={event => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
    </label>
    <div className="flex flex-wrap gap-2">
      {draft && <button className={button} type="button" disabled={!photo || working || reading || stale} onClick={() => void save(draft)}>Save account photo</button>}
      {draft && <button className={button} type="button" disabled={working} onClick={() => {
        selected.current++;
        setReading(false);
        setDraft(null);
        setError("");
      }}>Discard photo preview</button>}
      {photo?.dataUrl && <button className={button} type="button" disabled={working || reading} onClick={() => {
        if (window.confirm("Remove your account photo from all devices?")) void save(null);
      }}>Remove account photo</button>}
      <button className={button} type="button" disabled={working} onClick={() => void request()}>Refresh account photo</button>
    </div>
    {stale && <p role="status">The saved photo changed. Select your photo again to replace the latest version.</p>}
    {(message || error) && <p role="status">{error || message}</p>}
  </section>;
}
