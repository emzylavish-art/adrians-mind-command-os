import { useEffect, useId, useRef, useState } from "react";
import { Camera, ChevronRight, ExternalLink, Globe2, ImagePlus } from "lucide-react";
import { activityStorageKey, readBrowserActivity, websiteOpening, type BrowserActivityRow } from "@/lib/mind/browser-activity";
import { browserAddress } from "@/lib/mind/browser-permissions";
import { captureBrowserTab, readScreenshotFile, screenshotFile } from "./media/browser-screenshot";
import { InlineImage } from "./media/inline-image";

type AttachmentResult = { ok: true; name: string } | { ok: false; error: string };
type Props = {
  owner?: string | null;
  scope: string;
  persistent?: boolean;
  halted?: boolean;
  onAttach?: (file: File) => Promise<AttachmentResult>;
};
const control = "inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm";
const labels: Record<BrowserActivityRow["outcome"], string> = {
  requested: "Browser requested", returned: "Returned by you", cancelled: "Handoff ended", saved: "Screenshot saved on this device",
};

function browserMark(origin?: string) {
  const host = origin ? new URL(origin).hostname : "";
  if (host === "github.com") return "/brand/logos/github.svg";
  if (host === "vercel.com") return "/brand/logos/vercel.svg";
  if (host === "notion.so" || host.endsWith(".notion.com")) return "/brand/logos/notion.svg";
  if (host === "supabase.com") return "/brand/logos/supabase.svg";
  return null;
}

export function BrowserActivity(props: Props) {
  const key = props.owner && props.persistent !== false ? activityStorageKey(props.owner, props.scope) : null;
  return <ScopedBrowserActivity key={JSON.stringify([props.owner, props.scope, key])} {...props} storageKey={key} />;
}

function ScopedBrowserActivity({ owner, storageKey, onAttach, halted }: Props & { storageKey: string | null }) {
  const titleId = useId();
  const website = useRef<HTMLDialogElement>(null);
  const viewer = useRef<HTMLDialogElement>(null);
  const launch = useRef<HTMLButtonElement>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const captureOpener = useRef<HTMLElement | null>(null);
  const fileDestination = useRef<string | undefined>(undefined);
  const upload = useRef<HTMLInputElement>(null);
  const controller = useRef(new AbortController());
  const frame = useRef<AbortController | null>(null);
  const active = useRef<BrowserActivityRow[]>([]);
  const [rows, setRows] = useState<BrowserActivityRow[]>([]);
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState("");
  const [websiteNotice, setWebsiteNotice] = useState("");
  const [pending, setPending] = useState<{ id: string; origin: string } | null>(null);
  const [draft, setDraft] = useState<{ title: string; image: string; target?: string } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [canCapture, setCanCapture] = useState(false);
  const saving = useRef(false);
  const [reviewNotice, setReviewNotice] = useState("");
  const [storageFailed, setStorageFailed] = useState(false);

  useEffect(() => {
    const lifecycle = new AbortController();
    controller.current = lifecycle;
    setCanCapture(Boolean(navigator.mediaDevices?.getDisplayMedia));
    if (storageKey) {
      const sync = () => {
        try {
          active.current = readBrowserActivity(localStorage.getItem(storageKey));
          setRows(active.current);
          setStorageFailed(false);
        } catch { setStorageFailed(true); }
      };
      const changed = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) sync(); };
      sync();
      window.addEventListener("storage", changed);
      const localChanged = (event: Event) => {
        if (event instanceof CustomEvent && (event.detail === storageKey || event.detail === null)) sync();
      };
      window.addEventListener("adrian:browser-activity-updated", localChanged);
      return () => {
        window.removeEventListener("storage", changed);
        window.removeEventListener("adrian:browser-activity-updated", localChanged);
        lifecycle.abort();
        frame.current?.abort();
      };
    }
    return () => { lifecycle.abort(); frame.current?.abort(); };
  }, [storageKey]);

  useEffect(() => { if (pending) returnButton.current?.focus({ preventScroll: true }); }, [pending]);

  useEffect(() => {
    if (!halted) return;
    frame.current?.abort();
    frame.current = null;
    setCapturing(false);
    viewer.current?.close();
  }, [halted]);

  async function update(fn: (previous: BrowserActivityRow[]) => BrowserActivityRow[]) {
    const signal = controller.current.signal;
    function write() {
      signal.throwIfAborted();
      const baseline = storageKey ? readBrowserActivity(localStorage.getItem(storageKey)) : active.current;
      const next = fn(baseline);
      if (next.length > 12) throw new Error("Remove an older activity item before saving another.");
      if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
      active.current = next;
      setRows(next);
      if (storageKey) window.dispatchEvent(new CustomEvent("adrian:browser-activity-updated", { detail: storageKey }));
    }
    if (storageKey && navigator.locks) await navigator.locks.request(storageKey, { signal }, write);
    else write();
  }

  async function saveRow(row: BrowserActivityRow) {
    try {
      await update(current => current.some(item => item.id === row.id) ? current : [row, ...current]);
      return true;
    } catch (error) {
      if (!controller.current.signal.aborted) (row.kind === "screenshot" ? setReviewNotice : setNotice)(error instanceof DOMException ? "This device could not save the activity. Existing items were kept." : error instanceof Error ? error.message : "Activity could not be saved.");
      return false;
    }
  }

  async function previewCapture(file?: File, target?: string) {
    if (frame.current || halted) return;
    if (!file && document.activeElement instanceof HTMLElement) captureOpener.current = document.activeElement;
    const current = new AbortController();
    frame.current = current;
    setCapturing(true);
    setNotice("");
    try {
      const image = file ? await readScreenshotFile(file) : await captureBrowserTab(current.signal);
      current.signal.throwIfAborted();
      setReviewNotice("");
      setDraft({ title: file?.name.slice(0, 150) || "Browser tab screenshot", image, target });
      viewer.current?.showModal();
    } catch (error) {
      if (!current.signal.aborted) setNotice(error instanceof Error && (error.name === "Error" || error.name === "NotSupportedError") ? error.message : "Screenshot selection ended. No image was saved.");
    } finally {
      if (frame.current === current) {
        frame.current = null;
        if (!controller.current.signal.aborted) setCapturing(false);
      }
    }
  }

  function chooseFile(button: HTMLButtonElement, target?: string) {
    captureOpener.current = button;
    fileDestination.current = target;
    upload.current?.click();
  }

  function showWebsite(initial = "", resume: typeof pending = null) {
    setPending(resume);
    setAddress(initial);
    setWebsiteNotice("");
    website.current?.showModal();
  }

  useEffect(() => {
    const section = launch.current?.closest<HTMLElement>("[data-browser-scope]");
    if (!section) return;
    function openSuggested(event: Event) {
      if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail.href !== "string") return;
      if (section?.querySelector("[data-testid=browser-activity]") !== launch.current?.closest("[data-testid=browser-activity]")) return;
      captureOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      showWebsite(event.detail.href);
    }
    section.addEventListener("adrian:browser-handoff", openSuggested);
    return () => section.removeEventListener("adrian:browser-handoff", openSuggested);
  }, []);

  function openWebsite() {
    if (halted) { setWebsiteNotice("Clear the emergency stop before starting a new browser handoff."); return; }
    const result = websiteOpening(localStorage, owner ?? null, address, true);
    if (!result.url) { setWebsiteNotice(result.error); return; }
    // The tab must open from the user gesture. The receipt records the request;
    // a null window handle cannot distinguish a blocked popup from noopener.
    window.open(result.url.href, "_blank", "noopener,noreferrer");
    const item = { id: crypto.randomUUID(), origin: result.url.origin };
    setAddress("");
    setWebsiteNotice("");
    setPending(item);
    void saveRow({ ...item, kind: "website", title: item.origin, outcome: "requested", at: Date.now() });
  }

  async function endHandoff(returned: boolean) {
    if (!pending || saving.current) { if (!pending) website.current?.close(); return; }
    const item = pending;
    saving.current = true;
    try {
      const receipt = { ...item, kind: "website", title: item.origin, outcome: returned ? "returned" : "cancelled", at: Date.now() } as const;
      await update(current => current.some(row => row.id === item.id)
        ? current.map(row => row.id === item.id ? { ...row, ...receipt } : row)
        : [receipt, ...current]);
      setPending(null);
      website.current?.close();
      setNotice(returned ? "Return recorded. Check the website for your sign-in or other changes." : "Handoff ended. Close the website tab in your browser if it opened.");
    } catch {
      setWebsiteNotice("This device could not save the handoff result. Try again, or close this panel.");
    } finally {
      saving.current = false;
    }
  }

  async function attach(row: BrowserActivityRow) {
    if (!onAttach || !row.image || attaching || halted) return;
    const signal = controller.current.signal;
    setAttaching(true);
    try {
      const result = await onAttach(screenshotFile(row.image, row.kind === "website" ? new URL(row.origin!).hostname + "-screenshot" : row.title));
      if (!signal.aborted) setNotice(result.ok ? "Screenshot attached. Review it before sending." : result.error);
    } catch { if (!signal.aborted) setNotice("The screenshot could not be attached."); }
    finally { if (!signal.aborted) setAttaching(false); }
  }

  return <section className="min-w-0 space-y-2" aria-label="Browser and screenshots" data-testid="browser-activity">
    <div className="flex flex-wrap items-center gap-2">
      <button ref={launch} type="button" className={control} onClick={() => { captureOpener.current = launch.current; showWebsite(); }}>
        <Globe2 size={17} aria-hidden="true" /> Browser
      </button>
      <details>
        <summary className={control + " cursor-pointer"}><Camera size={17} aria-hidden="true" /> Screenshot</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {canCapture && <button type="button" className={control} disabled={capturing || storageFailed || halted} onClick={() => void previewCapture()}>Capture a browser tab</button>}
          <button type="button" className={control} disabled={capturing || storageFailed || halted} onClick={event => chooseFile(event.currentTarget)}><ImagePlus size={17} aria-hidden="true" /> Upload screenshot</button>
          {capturing && <button type="button" className={control} onClick={() => { frame.current?.abort(); frame.current = null; setCapturing(false); }}>Cancel screenshot</button>}
          <input ref={upload} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void previewCapture(file, fileDestination.current);
          }} />
        </div>
      </details>
    </div>
    {storageFailed && <p role="status" className="text-sm text-muted">This device could not read saved browser activity.</p>}
    {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
    {rows.length > 0 && <ol className="space-y-1" aria-label="Browser activity">
      {rows.map(row => {
        const Mark = row.kind === "website" ? Globe2 : Camera;
        const mark = browserMark(row.origin);
        return <li key={row.id} className="min-w-0">
          <details className="group min-w-0 rounded-panel border border-line bg-surface" open={row.kind === "screenshot" || row.image ? true : undefined}>
            <summary className="flex min-w-0 cursor-pointer list-none items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
              {mark ? <img src={mark} alt="" className="size-5 shrink-0" /> : <Mark size={19} className="shrink-0 text-accent" aria-hidden="true" />}
              <span className="min-w-0 flex-1 break-words text-sm font-medium">{row.title}<span className="block text-xs font-normal text-muted">{labels[row.outcome]}</span></span>
              <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted group-open:rotate-90" />
            </summary>
            <div className="space-y-2 px-3 pb-3">
              {row.image && <InlineImage wide src={row.image} alt={row.kind === "website" ? `Screenshot of ${row.title}` : row.title} onDownload={(data, name) => {
                const anchor = document.createElement("a");
                anchor.href = data;
                anchor.download = screenshotFile(data, name).name;
                anchor.click();
              }} />}
              <div className="flex flex-wrap items-center gap-3">
                {row.kind === "website" && row.outcome === "requested" && <button type="button" className={control} onClick={event => {
                  captureOpener.current = event.currentTarget;
                  showWebsite("", { id: row.id, origin: row.origin! });
                }}>Resume handoff</button>}
                {row.kind === "website" && !row.image && <>
                  <button type="button" className={control} disabled={capturing || storageFailed || halted} onClick={event => chooseFile(event.currentTarget, row.id)}>Add screenshot to this step</button>
                  {canCapture && <button type="button" className={control} disabled={capturing || storageFailed || halted} onClick={() => void previewCapture(undefined, row.id)}>Capture a tab for this step</button>}
                </>}
                {row.image && onAttach && <button type="button" className={control} disabled={attaching || halted} onClick={() => void attach(row)}>Attach to composer</button>}
                <time className="text-xs text-muted" dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleString()}</time>
                <button type="button" className="min-h-11 text-sm text-muted underline" onClick={async () => {
                  try { await update(current => current.filter(item => item.id !== row.id)); setNotice("Activity item removed."); }
                  catch { setNotice("The activity item could not be removed."); }
                }}>Remove item</button>
              </div>
            </div>
          </details>
        </li>;
      })}
    </ol>}
    <dialog ref={website} aria-labelledby={titleId} className="fixed inset-x-3 bottom-4 top-auto m-auto w-[calc(100%-1.5rem)] max-w-lg max-h-[88dvh] overflow-auto rounded-panel border border-line bg-surface p-4 text-fg backdrop:bg-black/65 sm:inset-y-0 sm:bottom-0"
      onClose={() => captureOpener.current?.focus({ preventScroll: true })}
      onCancel={event => { event.preventDefault(); void endHandoff(false); }}>
      <div className="flex min-w-0 items-center gap-3"><Globe2 size={23} aria-hidden="true" /><h2 className="text-lg font-semibold" id={titleId}>{pending ? "Continue in your browser" : "Open a website"}</h2></div>
      {pending ? <div className="mt-3 space-y-3">
        <p className="break-all text-sm font-medium">{pending.origin}</p>
        <p className="text-sm text-muted">Check your browser for the new tab. If the website asks you to sign in, enter your details on its own page. Return here when you’re finished.</p>
        {websiteNotice && <p role="status" className="text-sm text-danger">{websiteNotice}</p>}
        <div className="flex flex-wrap gap-2"><button ref={returnButton} type="button" className={control + " bg-accent text-accent-ink"} onClick={() => void endHandoff(true)}>I’m back</button><button type="button" className={control} onClick={() => void endHandoff(false)}>End handoff</button><button type="button" className={control} onClick={() => website.current?.close()}>Close panel</button></div>
      </div> : <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); openWebsite(); }}>
        <label className="block space-y-1 text-sm"><span>Website address</span><input value={address} onChange={event => { setAddress(event.target.value); setWebsiteNotice(""); }} type="text" inputMode="url" spellCheck={false} autoCapitalize="off" autoComplete="off" placeholder="https://example.com" className="min-h-11 w-full rounded-panel border border-line bg-bg px-3" maxLength={4096} /></label>
        {browserAddress(address) && <p className="break-all text-xs text-muted">{browserAddress(address)?.origin}</p>}
        {websiteNotice && <p role="status" className="text-sm text-danger">{websiteNotice}</p>}
        <div className="flex flex-wrap gap-2"><button type="submit" className={control + " bg-accent text-accent-ink"} disabled={!address.trim() || halted}>Open in browser <ExternalLink size={15} aria-hidden="true" /></button><button type="button" className={control} onClick={() => website.current?.close()}>Cancel</button></div>
      </form>}
    </dialog>
    <dialog ref={viewer} aria-label="Review screenshot" className="fixed inset-0 m-auto max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-3xl rounded-panel border border-line bg-surface p-4 text-fg backdrop:bg-black/70"
      onClose={() => { setDraft(null); captureOpener.current?.focus({ preventScroll: true }); }}>
      {draft && <div className="space-y-3">
        <h2 className="font-semibold">Review screenshot</h2>
        <p className="text-sm text-muted">{storageKey ? "Saved screenshots stay on this device until you remove them." : "This screenshot stays in this session."} Check for private details before saving or attaching.</p>
        {reviewNotice && <p className="text-sm text-danger" role="status">{reviewNotice}</p>}
        <img src={draft.image} alt={draft.title} className="max-h-[55dvh] w-full rounded-panel object-contain" />
        <div className="flex flex-wrap gap-2"><button type="button" className={control + " bg-accent text-accent-ink"} onClick={async () => {
          if (saving.current) return;
          saving.current = true;
          let saved = false;
          if (draft.target) {
            try {
              await update(current => {
                if (!current.some(row => row.id === draft.target && row.kind === "website" && !row.image)) throw new Error("That browser step changed. Save a separate screenshot.");
                return current.map(row => row.id === draft.target ? { ...row, image: draft.image } : row);
              });
              saved = true;
            } catch { setReviewNotice("That browser step could not save the screenshot. Discard and try again."); }
          } else {
            saved = await saveRow({ id: crypto.randomUUID(), kind: "screenshot", outcome: "saved", title: draft.title, image: draft.image, at: Date.now() });
          }
          saving.current = false;
          if (saved) {
            viewer.current?.close();
            setNotice(storageKey ? "Screenshot saved to this activity on this device." : "Screenshot saved in this session.");
          }
        }}>Save screenshot</button><button type="button" className={control} onClick={() => viewer.current?.close()}>Discard</button></div>
      </div>}
    </dialog>
  </section>;
}
