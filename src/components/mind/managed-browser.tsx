import { useEffect, useState, type MouseEvent } from "react";
import { getBearerToken } from "@/lib/auth/client";
import { MANAGED_VIEWPORT, type ManagedAction, type ManagedBrowserReceipt, type ManagedBrowserSession } from "@/lib/mind/managed-browser";

const control = "min-h-11 rounded-panel border border-line px-3";
const timeText = (value: string) => new Date(value).toLocaleString();

export function ManagedBrowser({ owner, halted }: { owner: string; halted?: boolean }) {
  const [origins, setOrigins] = useState<string[] | null>(null);
  const [origin, setOrigin] = useState("");
  const [session, setSession] = useState<ManagedBrowserSession | null>(null);
  const [frame, setFrame] = useState("");
  const [receipts, setReceipts] = useState<ManagedBrowserReceipt[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const token = getBearerToken();
    void fetch("/api/mind/managed-browser", {
      credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: token ? { authorization: "Bearer " + token } : {},
    }).then(async response => {
      if (!response.ok) throw Error();
      const result = await response.json();
      if (controller.signal.aborted) return;
      setOrigins(result.origins);
      setOrigin(result.origins[0] ?? "");
      setSession(result.session);
      setReceipts(result.receipts ?? []);
    }).catch(() => { if (!controller.signal.aborted) setStatus("Managed browser settings could not be verified."); });
    return () => controller.abort();
  }, [owner]);

  async function send(action: ManagedAction) {
    if (busy || (halted && action.kind !== "stop" && action.kind !== "status")) return;
    setBusy(true);
    setStatus("");
    try {
      const token = getBearerToken();
      const response = await fetch("/api/mind/managed-browser", {
        credentials: "same-origin", method: "POST", cache: "no-store",
        headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
        body: JSON.stringify({ owner, id: session?.id, action }),
      });
      const result = await response.json();
      if (result.session) setSession(result.session);
      if (result.receipts) setReceipts(result.receipts);
      if (result.frame) setFrame(result.frame);
      else if (action.kind === "start" || action.kind === "handback" || result.session?.mode === "stopped" || result.session?.mode === "unconfirmed") setFrame("");
      if (!response.ok) throw Error(result.error || "The browser operation could not be confirmed.");
      setStatus(action.kind === "stop" ? "Browser closed." : "Browser worker confirmed the action.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Check browser status before retrying."); }
    finally { setBusy(false); }
  }

  function click(event: MouseEvent<HTMLButtonElement>) {
    if (session?.mode !== "takeover" || halted) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = event.detail !== 0;
    const x = pointer ? Math.floor((event.clientX - rect.left) / rect.width * MANAGED_VIEWPORT.width) : MANAGED_VIEWPORT.width / 2;
    const y = pointer ? Math.floor((event.clientY - rect.top) / rect.height * MANAGED_VIEWPORT.height) : MANAGED_VIEWPORT.height / 2;
    if (x >= 0 && x < MANAGED_VIEWPORT.width && y >= 0 && y < MANAGED_VIEWPORT.height) void send({ kind: "click", x, y });
  }

  const active = session && session.mode !== "stopped";
  return <section className="space-y-3 rounded-panel border border-line p-3" aria-label="Managed browser">
    <h4 className="font-semibold">Managed browser</h4>
    {origins && origins.length === 0 && <p className="text-muted">A managed browser worker can be connected by your workspace operator.</p>}
    {origins && origins.length > 0 && !active && <div className="flex flex-wrap gap-2">
      <select aria-label="Approved managed website" className={control} value={origin} onChange={event => setOrigin(event.target.value)} disabled={busy}>
        {origins.map(site => <option value={site} key={site}>{site}</option>)}
      </select>
      <button type="button" className={control} disabled={busy || halted || !origin} onClick={() => void send({ kind: "start", origin })}>Start managed browser</button>
    </div>}
    {session && <p className="break-words">Session {session.id.slice(0, 8)} · {session.origin} · {session.mode} · {session.operation} · {timeText(session.updatedAt)}</p>}
    {active && <div className="flex flex-wrap gap-2">
      <button type="button" className={control} disabled={busy} onClick={() => void send({ kind: "status" })}>Check browser status</button>
      {session.mode !== "unconfirmed" && <button type="button" className={control} disabled={busy || halted} onClick={() => void send({ kind: "capture" })}>Refresh browser view</button>}
      {session.mode === "managed" && <button type="button" className={control} disabled={busy || halted} onClick={() => void send({ kind: "takeover" })}>Take control</button>}
      {session.mode === "takeover" && <button type="button" className={control} disabled={busy || halted} onClick={() => void send({ kind: "handback" })}>Hand back control</button>}
      <button type="button" className={control} disabled={busy} onClick={() => void send({ kind: "stop" })}>Stop browser</button>
    </div>}
    {frame && active && session.mode !== "unconfirmed" && (session.mode === "takeover"
      ? <button className="block w-full max-w-3xl overflow-hidden rounded-panel" type="button" aria-label="Interact with browser view" disabled={busy || halted} onClick={click}>
        <img className="block h-auto w-full" src={"data:image/jpeg;base64," + frame} alt="Isolated browser viewport" />
      </button>
      : <img className="h-auto w-full max-w-3xl rounded-panel" src={"data:image/jpeg;base64," + frame} alt="Isolated browser viewport" />)}
    {active && session.mode === "takeover" && <div className="flex flex-wrap gap-2">
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); if (text.trim()) { void send({ kind: "text", text }); setText(""); } }}>
        <input className={control} aria-label="Text for focused browser field" type="password" maxLength={300} autoComplete="off" value={text}
          onChange={event => setText(event.target.value)} disabled={busy || halted} />
        <button type="submit" className={control} disabled={busy || halted || !text.trim()}>Type in focused field</button>
      </form>
      {(["Enter", "Tab", "Backspace", "Escape"] as const).map(key => <button className={control} key={key} type="button" disabled={busy || halted}
        onClick={() => void send({ kind: "key", key })}>{key}</button>)}
    </div>}
    {status && <p role="status">{status}</p>}
    {receipts.length > 0 && <details>
      <summary>Recent browser receipts</summary>
      <ul className="space-y-1">{receipts.map(receipt => <li key={receipt.id}>
        {receipt.action} · {receipt.outcome} · <time dateTime={receipt.at}>{timeText(receipt.at)}</time>
      </li>)}</ul>
    </details>}
  </section>;
}
