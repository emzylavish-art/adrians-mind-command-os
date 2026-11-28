import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { SharedText } from "@/lib/mind/chat-share";
import { shareRequest } from "@/lib/mind/chat-share-client";

export const Route = createFileRoute("/shared-chat")({ component: SharedConversation });
function SharedConversation() {
  const [text, setText] = useState<SharedText | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    setReady(true);
    function invalidate() { revision.current++; }
    function clear() { invalidate(); setText(null); setStatus(""); setBusy(false); }
    function hidden() { if (document.hidden) clear(); }
    window.addEventListener("hashchange", clear); window.addEventListener("pagehide", clear);
    document.addEventListener("visibilitychange", hidden);
    return () => { invalidate(); window.removeEventListener("hashchange", clear); window.removeEventListener("pagehide", clear); document.removeEventListener("visibilitychange", hidden); };
  }, []);
  async function open() {
    const current = ++revision.current;
    setBusy(true); setText(null); setStatus("");
    try {
      const result = await shareRequest({ action: "open", token: location.hash.slice(1) });
      if (current === revision.current) setText(result.text);
    } catch (error) { if (current === revision.current) setStatus(error instanceof Error ? error.message : "The link is unavailable."); }
    finally { if (current === revision.current) setBusy(false); }
  }
  return <main className="mx-auto max-w-3xl space-y-4 p-5">
    <h1 className="text-2xl font-semibold">{text?.title || "Shared conversation"}</h1>
    <button type="button" className="min-h-11 underline" disabled={!ready || busy} onClick={() => void open()}>{text ? "Refresh shared conversation" : "Open shared conversation"}</button>
    {status && <p role="status">{status} <a href="/login" target="_blank" rel="noreferrer" className="underline">Sign in</a></p>}
    {text?.messages.map((m,i) => <article key={i} className="space-y-1 whitespace-pre-wrap break-words"><h2 className="font-semibold">{m.role === "user" ? "User" : "Adrian"}</h2><p>{m.text}</p></article>)}
  </main>;
}
