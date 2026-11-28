import { useCallback, useEffect, useRef, useState } from "react";
import { shareRequest } from "@/lib/mind/chat-share-client";
import { chatTextDigest, shareableChatText, type SharedText } from "@/lib/mind/chat-share";
import type { Chat } from "@/lib/mind/types";

type LinkRow = { id: string; chatId: string; createdAt: string };
export function SharedChatLinks({ owner, chats, initialChatId }: { owner: string; chats: Chat[]; initialChatId?: string }) {
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [selected, setSelected] = useState(initialChatId ?? "");
  const attempt = useRef<{ chatId: string; digest: string; token: string } | null>(null);
  const [created, setCreated] = useState<{ url: string; preview: string } | null>(null);
  const [review, setReview] = useState<{ id: string; text: SharedText } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try {
      const result = await shareRequest();
      if (result.owner !== owner || !Array.isArray(result.links)) throw Error("Reopen Settings for the active account.");
      if (revision.current === current) setLinks(result.links);
    } catch (err) {
      if (revision.current === current) { setLinks(null); setStatus(err instanceof Error ? err.message : "Could not load shared links."); }
    }
  }, [owner]);
  useEffect(() => {
    void refresh();
    const invalidate = () => { revision.current++; };
    return invalidate;
  }, [refresh]);
  const chat = chats.find(item => item.id === selected);
  const preview = chat && shareableChatText(chat);
  function select(id: string) {
    setSelected(id); setStatus(""); setCreated(null);
    attempt.current = null;
  }
  async function change(action: "create" | "revoke" | "review", id?: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setStatus(""); setReview(null);
    try {
      if (action === "review" && id) {
        const result = await shareRequest({ action, ownerId: owner, id });
        setReview({ id, text: result.text });
      } else if (action === "revoke") {
        const result = await shareRequest({ action, ownerId: owner, id });
        if (result.revoked !== id) throw Error("Revocation could not be confirmed.");
        select(""); setStatus("Link revoked.");
      } else {
        if (!preview) return;
        const digest = await chatTextDigest(preview);
        if (attempt.current?.chatId !== selected || attempt.current.digest !== digest) {
          attempt.current = { chatId: selected, digest, token: Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join("") };
        }
        const { token } = attempt.current;
        const result = await shareRequest({ action, ownerId: owner, chatId: selected, digest, token });
        if (!result.created) throw Error("Link creation could not be confirmed.");
        setCreated({ url: location.origin + "/shared-chat#" + token, preview: JSON.stringify(preview) });
      }
      await refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "The operation could not be confirmed."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="settings-card space-y-3 rounded-panel p-4 text-sm">
    <h3 className="font-semibold">Shared chat links</h3>
    <button type="button" className="min-h-11 underline" disabled={busy} onClick={() => void refresh()}>Refresh shared links</button>
    {links?.length === 0 && <p>No active shared links.</p>}
    <ul>{links?.map(link => <li key={link.id} className="flex flex-wrap items-center justify-between gap-2">
      <span>{chats.find(item => item.id === link.chatId)?.title || "Saved conversation"} · {new Date(link.createdAt).toLocaleString()}</span>
      <button type="button" disabled={busy} className="min-h-11 underline" onClick={() => void change("review", link.id)}>Review shared text</button>
      <button type="button" disabled={busy} className="min-h-11 underline" onClick={() => void change("revoke", link.id)}>Revoke link</button>
      {review?.id === link.id && <div aria-label="Text available through this link" className="w-full whitespace-pre-wrap break-words">
        <strong>{review.text.title}</strong>{review.text.messages.map((m,i) => <p key={i}><b>{m.role === "user" ? "You" : "Adrian"}</b> {m.text}</p>)}
      </div>}
    </li>)}</ul>
    <label className="block">Conversation to share <select value={selected} disabled={busy} onChange={e => select(e.target.value)} className="min-h-11 max-w-full">
      <option value="">Choose a conversation</option>{chats.filter(c => !c.temporary).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
    </select></label>
    {chat && !preview && <p>No completed text to share.</p>}
    {preview && <><p>Anyone signed in with the link can read the text below. The link opens only while the saved text matches this preview. Revoking access cannot recall copies someone already saved.</p>
      <div className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-panel border border-line p-3" aria-label="Shared text preview">
        <strong>{preview.title}</strong>{preview.messages.map((m,i) => <p key={i}><b>{m.role === "user" ? "You" : "Adrian"}</b> {m.text}</p>)}
      </div>
      {created?.preview === JSON.stringify(preview) && created ? <label className="block">Shareable link <input className="w-full" readOnly value={created.url} onFocus={e => e.target.select()} /></label> :
        <button type="button" className="min-h-11 underline" disabled={busy} onClick={() => void change("create")}>Create link for this text</button>}
    </>}
    {status && <p role="status">{status}</p>}
  </section>;
}
