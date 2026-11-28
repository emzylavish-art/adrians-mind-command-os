import { useEffect, useRef, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { type QueueTransferBinding, transferableCue, transferIdPattern } from "@/lib/mind/queue-transfer";
import type { CuedMessage } from "@/lib/mind/message-cue";

type TransferItem = { id: string; state: "waiting" | "claimed"; createdAt: string };
type Reply = { error?: string; items?: TransferItem[]; item?: unknown; saved?: string; received?: string; cancelled?: string };
type Receipt = { token: string; savedLocally?: boolean };

export function QueueTransferPanel({ binding, local }: { binding: QueueTransferBinding; local: CuedMessage[] }) {
  const [rows, setRows] = useState<TransferItem[] | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const lifecycle = new AbortController();
    controller.current = lifecycle;
    return () => lifecycle.abort();
  }, []);

  const scope = JSON.stringify(binding.scope);
  const recoveryKey = (id: string) => "amcos.queue-transfer.v1." + encodeURIComponent(JSON.stringify([binding.owner, scope, id]));
  function readReceipt(id: string): Receipt | null {
    try {
      const value = JSON.parse(sessionStorage.getItem(recoveryKey(id)) ?? "null");
      return value && typeof value.token === "string" && transferIdPattern.test(value.token) ? value : null;
    } catch { return null; }
  }

  async function request(action: string, body: object, signal: AbortSignal) {
    const bearer = getBearerToken();
    const prefix = previewPathPrefix(location.hostname, location.pathname) ?? "";
    const response = await fetch(prefix + "/api/mind/queue-transfer", {
      method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "content-type": "application/json", ...(bearer ? { authorization: "Bearer " + bearer } : {}) },
      body: JSON.stringify({ owner: binding.owner, scope: binding.scope, action, ...body }),
    });
    const result: Reply = await response.json();
    if (!response.ok) throw new Error(result.error || "The device queue could not confirm this action.");
    return result;
  }

  async function run(work: (signal: AbortSignal) => Promise<string>) {
    if (busy || !controller.current) return;
    const { signal } = controller.current;
    setBusy(true);
    setNotice("");
    try {
      const message = await work(signal);
      const result = await request("list", {}, signal);
      if (!signal.aborted) { setRows(result.items ?? []); setNotice(message); }
    } catch (error) {
      if (!signal.aborted) setNotice(error instanceof Error ? error.message : "The device queue is unavailable.");
    } finally { if (!signal.aborted) setBusy(false); }
  }

  function recover(id: string) {
    void run(async signal => {
      let receipt = readReceipt(id);
      if (!receipt) {
        receipt = { token: crypto.randomUUID() };
        sessionStorage.setItem(recoveryKey(id), JSON.stringify(receipt));
      }
      const data = { id, claimId: receipt.token };
      if (!receipt.savedLocally) {
        const result = await request("claim", data, signal);
        signal.throwIfAborted();
        const item = transferableCue(result.item);
        if (!item || item.id !== id) throw new Error("The saved draft could not be verified.");
        if (!binding.receive(item)) throw new Error("This queue could not save the draft. Clear space and retry on this tab. The device copy is still available.");
        sessionStorage.setItem(recoveryKey(id), JSON.stringify({ ...receipt, savedLocally: true }));
      }
      const result = await request("finish", data, signal);
      if (result.received !== id) throw new Error("The draft is held here. Retry to confirm recovery.");
      signal.throwIfAborted();
      sessionStorage.removeItem(recoveryKey(id));
      return "Recovered into this queue for review.";
    });
  }

  return <details className="queue-row">
    <summary className="queue-action">Across devices</summary>
    <p className="queue-description">Save a copy of a held draft and its attachments to your account. Recover it into the same queue on another device for review.</p>
    <button type="button" className="queue-action" disabled={busy} onClick={() => void run(async () => "Device queue checked.")}>Check saved drafts</button>
    {local.flatMap((row, index) => {
      const item = row.paused === false ? null : transferableCue(row);
      if (!item) return [];
      return <button key={row.id} type="button" className="queue-action" disabled={busy || Boolean(rows?.some(copy => copy.id === item.id))}
        onClick={() => void run(async signal => {
          const result = await request("save", { item }, signal);
          if (result.saved !== item.id) throw new Error("The saved draft could not be confirmed.");
          return "Copy available on another signed-in device. This tab still has its original draft.";
        })}>Save queued draft {index + 1} for another device</button>;
    })}
    {rows?.length === 0 && <p className="queue-description">No drafts await recovery.</p>}
    {rows && rows.length > 0 && <ul>{rows.map((row, index) => {
      const ownClaim = readReceipt(row.id);
      return <li key={row.id} className="queue-row">
        <p className="queue-message">Saved draft {index + 1} · {new Date(row.createdAt).toLocaleString()}{row.state === "claimed" ? " · recovery started" : ""}</p>
        <div className="queue-actions">
          {(row.state === "waiting" || ownClaim) && <button type="button" className="queue-action" disabled={busy} onClick={() => recover(row.id)}>{row.state === "waiting" ? "Recover to this queue" : "Continue recovery"}</button>}
          {review !== row.id ? <button type="button" className="queue-action" disabled={busy} onClick={() => setReview(row.id)}>Remove saved copy</button> : <>
            <p className="queue-description">This removes the account copy. Drafts already on a device are kept.</p>
            <button type="button" className="queue-action" disabled={busy} onClick={() => void run(async signal => {
              const result = await request("cancel", { id: row.id }, signal);
              if (result.cancelled !== row.id) throw new Error("Removal could not be confirmed.");
              setReview(null);
              return "Saved copy removed.";
            })}>Confirm removal</button>
            <button type="button" className="queue-action" onClick={() => setReview(null)}>Keep copy</button>
          </>}
        </div>
      </li>;
    })}</ul>}
    {notice && <p role="status" className="queue-description">{notice}</p>}
  </details>;
}
