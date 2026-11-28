import { useEffect, useRef, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import {
  managedBrowserHeight, managedBrowserUrl, managedBrowserWidth,
  type BrowserInput, type BrowserPhase, type ManagedBrowserSession, type ManagedFrame,
} from "@/lib/mind/managed-browser";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

const button = "min-h-11 rounded-panel border border-line bg-surface px-3 disabled:opacity-50";
const phases: Record<BrowserPhase, string> = {
  starting: "Starting", managed: "Managed view", manual: "You have control",
  closed: "Closed", uncertain: "State needs checking",
};

type BrowserReply = {
  configured?: boolean; origins?: string[]; sessions?: ManagedBrowserSession[];
  session?: ManagedBrowserSession; frame?: ManagedFrame; refusedLink?: boolean; error?: string;
};

async function browserRequest(owner: string, body: object, signal: AbortSignal): Promise<BrowserReply> {
  const prefix = previewPathPrefix(location.hostname, location.pathname) ?? "";
  const bearer = getBearerToken();
  const response = await fetch(prefix + "/api/mind/managed-browser", {
    method: "POST", signal, credentials: "same-origin", cache: "no-store",
    headers: { "content-type": "application/json", ...(bearer && { authorization: "Bearer " + bearer }) },
    body: JSON.stringify({ ...body, owner }),
  });
  const reply = await response.json() as BrowserReply;
  if (!response.ok) throw new Error(reply.error ?? "Browser state could not be confirmed.");
  return reply;
}

export function ManagedBrowserSettings({ owner, halted, canOpen, initialAddress = "", onScreenshot }: {
  owner: string; halted?: boolean; canOpen: (url: URL) => boolean;
  initialAddress?: string; onScreenshot?: (image: string, title: string) => void;
}) {
  const request = useRef<AbortController | null>(null);
  const [origins, setOrigins] = useState<string[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<ManagedBrowserSession[]>([]);
  const [frame, setFrame] = useState<ManagedFrame>();
  const [address, setAddress] = useState(initialAddress);
  const [approved, setApproved] = useState<URL>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const session = sessions.find(item => item.phase !== "closed" && Date.parse(item.expires) > Date.now());
  const recent = session ?? sessions[0];

  async function send(body: object) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFrame(undefined);
    setNotice("");
    try {
      const reply = await browserRequest(owner, body, controller.signal);
      if (controller.signal.aborted) return;
      if (reply.sessions) {
        setConfigured(reply.configured === true);
        setOrigins(reply.origins ?? []);
        setSessions(reply.sessions);
      }
      if (reply.session) {
        const saved = reply.session;
        setSessions(prev => [saved, ...prev.filter(item => item.id !== saved.id)].slice(0, 8));
        setFrame(reply.frame);
        if (reply.refusedLink) setNotice("Choose a link inside the approved website.");
      }
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Browser state could not be confirmed.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    void send({ action: "list" });
    return () => { request.current?.abort(); request.current = null; };
    // The keyed parent remounts this section when the account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session) return;
    const delay = Date.parse(session.expires) - Date.now();
    const timer = setTimeout(() => setFrame(undefined), Math.max(0, delay));
    return () => clearTimeout(timer);
  }, [session]);

  function act(input: BrowserInput) {
    if (recent) void send({ ...input, id: recent.id, revision: recent.revision });
  }

  const canView = session && !busy && !halted && !session.pending && canOpen(new URL(session.origin));
  return <section aria-label="Managed browsing" className="space-y-3 border-t border-line pt-4">
    <h4 className="font-semibold">Managed browsing</h4>
    <p className="text-muted">View an approved public site in an isolated browser. Take control to follow links on that site and scroll. Use the personal browser for sign-in and forms.</p>
    {configured === false && <p>The browser worker is unavailable.</p>}
    {configured && !session && <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault();
      const url = managedBrowserUrl(address.trim());
      if (!url || !origins.includes(url.origin) || !canOpen(url)) {
        setNotice("Enter an approved HTTPS website that your preferences allow.");
        return;
      }
      setNotice("");
      setApproved(url);
    }}>
      <label className="flex min-w-0 flex-1 flex-col gap-1">
        Website
        <input className={button} placeholder={origins[0] ?? "https://example.com"} value={address}
          onChange={event => { setAddress(event.target.value); setApproved(undefined); }} />
      </label>
      <button className={button} disabled={busy || halted} type="submit">Review website</button>
    </form>}
    {approved && !session && <div className="space-y-2">
      <p className="break-all">Open {approved.href} for up to 15 minutes?</p>
      <button type="button" className={button} disabled={busy || halted || !canOpen(approved)} onClick={() => {
        const target = approved.href;
        setApproved(undefined);
        void send({ action: "start", target, approved: true, id: crypto.randomUUID() });
      }}>Approve and open</button>
    </div>}
    {recent && <div className="space-y-2 rounded-panel border border-line p-3">
      <p className="break-all font-medium">{recent.origin} · {recent.pending ? "Checking prior action" : phases[recent.phase]}{!session && recent.phase !== "closed" ? " · Expired" : ""}</p>
      <div className="flex flex-wrap gap-2">
        {recent.phase !== "closed" && <>
          <button type="button" className={button} disabled={busy} onClick={() => act({ action: "recover" })}>Check state</button>
          {canView && ["managed", "manual"].includes(recent.phase) && <button type="button" className={button} onClick={() => act({ action: "frame" })}>Refresh view</button>}
          {canView && recent.phase === "managed" && <button type="button" className={button} onClick={() => act({ action: "takeover" })}>Take control</button>}
          {canView && recent.phase === "manual" && <>
            <button type="button" className={button} onClick={() => act({ action: "scroll", delta: -540 })}>Scroll up</button>
            <button type="button" className={button} onClick={() => act({ action: "scroll", delta: 540 })}>Scroll down</button>
            <button type="button" className={button} onClick={() => act({ action: "handback" })}>Hand back</button>
          </>}
          <button type="button" className={button} disabled={busy} onClick={() => act({ action: "stop" })}>Close session</button>
        </>}
      </div>
      {canView && frame && <figure className="space-y-1">
        <img src={"data:image/jpeg;base64," + frame.image} alt={"Browser view of " + frame.path}
          width={managedBrowserWidth} height={managedBrowserHeight} className="h-auto w-full rounded-panel border border-line"
          onClick={recent.phase === "manual" ? event => {
            const bounds = event.currentTarget.getBoundingClientRect();
            act({ action: "follow", x: (event.clientX - bounds.left) * managedBrowserWidth / bounds.width,
              y: (event.clientY - bounds.top) * managedBrowserHeight / bounds.height });
          } : undefined} />
        <figcaption className="break-all text-muted">{frame.path}{recent.phase === "manual" ? " · Select a visible link to follow it" : ""}</figcaption>
        {recent.phase === "manual" && Boolean(frame.links?.length) && <details>
          <summary className="min-h-11 py-3">Links in this view</summary>
          <ul className="flex flex-wrap gap-2">
            {frame.links?.map(({ x, y, label }, index) =>
              <li key={index}><button type="button" className={button + " break-all"} onClick={() => act({ action: "follow", x, y })}>{label}</button></li>,
            )}
          </ul>
        </details>}
        {onScreenshot && <button type="button" className={button} onClick={() =>
          onScreenshot("data:image/jpeg;base64," + frame.image, "Screenshot of " + new URL(recent.origin).hostname)
        }>Review screenshot</button>}
      </figure>}
      {recent.receipts.length > 0 && <details>
        <summary>Session activity</summary>
        <ul className="space-y-1 pt-2 text-muted">
          {[...recent.receipts].reverse().map((receipt, index) => <li key={receipt.at + index}>
            <time dateTime={receipt.at}>{new Date(receipt.at).toLocaleTimeString()}</time> · {receipt.action} · {receipt.outcome ?? phases[receipt.phase]}
          </li>)}
        </ul>
      </details>}
    </div>}
    <button type="button" className={button} disabled={busy} onClick={() => void send({ action: "list" })}>Reload sessions</button>
    <p role="status" className="text-muted">{busy ? "Checking browser state…" : notice}</p>
  </section>;
}
