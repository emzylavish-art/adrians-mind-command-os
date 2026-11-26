import { useEffect, useRef, useState } from "react";
import { clearLocalRetention, LOCAL_RETENTION_TARGETS, RETENTION_DESCRIPTIONS, verifyDeletionAcknowledgement, type LocalRetentionTarget, type RetentionReceipt } from "@/lib/mind/data-retention";
import { accountOriginalFileStore } from "@/lib/mind/library-documents";
import { accountImageStore } from "@/lib/mind/media/blob-store";
import { clearDeviceVideos } from "@/lib/mind/media/video-device-store";
import { accountKnowledgeStore } from "@/lib/mind/knowledge-index";
import { clearAccountDrafts } from "@/lib/mind/use-composer-draft";
import type { Workspace } from "@/lib/mind/types";
import { ResourceState } from "./resource-state";

export function DataRetentionCenter({ ownerId, workspace, syncNote, onExport, verifyServerCopy, onLocalCleared }: { ownerId: string; workspace: Workspace; syncNote?: string; onExport?: () => void; verifyServerCopy?: () => Promise<{ ok: boolean; workspace?: Workspace | null; error?: string }>; onLocalCleared?: (targets: LocalRetentionTarget[]) => void }) {
  const [selected, setSelected] = useState<LocalRetentionTarget[]>([]);
  const [review, setReview] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [receipts, setReceipts] = useState<RetentionReceipt[]>([]);
  const [verification, setVerification] = useState<ReturnType<typeof verifyDeletionAcknowledgement> | null>(null);
  const [error, setError] = useState("");
  const identity = useRef(ownerId); identity.current = ownerId;
  useEffect(() => { setSelected([]); setReview(false); setConfirmation(""); setReceipts([]); setVerification(null); setPending(false); setError(""); }, [ownerId]);
  const clear = async () => {
    if (confirmation !== "CLEAR LOCAL DATA" || !selected.length || pending) return;
    const owner = ownerId; const targets = [...selected]; setPending(true); setError("");
    try {
      const result = await clearLocalRetention(owner, targets, { local: localStorage, session: sessionStorage, originals: accountOriginalFileStore(owner), images: accountImageStore(owner), videos: { clear: () => clearDeviceVideos(owner) }, knowledge: accountKnowledgeStore(owner), afterDraftClear: () => clearAccountDrafts(owner) });
      if (owner !== identity.current) return;
      setReceipts(result); setReview(false); setConfirmation(""); setSelected([]); onLocalCleared?.(result.filter((receipt) => receipt.state === "locally-cleared").map((receipt) => receipt.target));
    } catch (cause) { if (owner === identity.current) setError(cause instanceof Error ? cause.message : "Removal did not complete."); }
    finally { if (owner === identity.current) setPending(false); }
  };
  const verify = async () => {
    if (!verifyServerCopy || pending) return;
    const owner = ownerId; setPending(true); setError("");
    try { const result = await verifyServerCopy(); if (owner !== identity.current) return; if (!result.ok) throw new Error(result.error || "The managed server copy could not be read."); setVerification(verifyDeletionAcknowledgement(workspace, result.workspace ?? null)); }
    catch (cause) { if (owner === identity.current) { setVerification(null); setError(cause instanceof Error ? cause.message : "Deletion status is unknown."); } }
    finally { if (owner === identity.current) setPending(false); }
  };
  return <section className="space-y-4 rounded-xl border border-white/10 p-4" aria-labelledby="retention-heading"><div className="flex flex-wrap justify-between gap-2"><h3 id="retention-heading" className="font-medium">Data and retention</h3>{onExport && <button type="button" className="text-xs underline" onClick={onExport}>Export workspace archive</button>}</div>
    <p className="text-xs text-muted-foreground">Your current workspace contains {workspace.chats.length} conversations, {workspace.memories.length} memory notes, {workspace.files.length} Library entries and {workspace.runs.length} agent runs. Workspace archives contain structured records and references; download original documents, images and videos separately. {syncNote}</p>
    {pending && <ResourceState phase="loading" title={review ? "Removing the selected local copies" : "Checking managed server deletion acknowledgement"}>Wait for an acknowledgement before treating the operation as complete.</ResourceState>}
    <div className="text-xs space-y-2"><p>Conversation and memory removal creates durable tombstones. A local removal waits for server acknowledgment. A quoted copy, exported file or independently saved document has its own lifecycle.</p><button type="button" className="underline" disabled={!verifyServerCopy || pending} onClick={() => void verify()}>Check managed server deletion acknowledgment</button>{verification && <p role="status">{verification.confirmedChatIds.length + verification.confirmedMemoryIds.length} of {verification.locallyRemoved} local deletion markers acknowledged by the managed server; {verification.pendingChatIds.length + verification.pendingMemoryIds.length} pending. {verification.scope}</p>}</div>
    <fieldset disabled={pending || review} className="space-y-3"><legend className="text-sm mb-2">Choose local copies to remove</legend>{LOCAL_RETENTION_TARGETS.map((target) => <label key={target} className="flex gap-3 items-start text-xs"><input type="checkbox" checked={selected.includes(target)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, target] : current.filter((item) => item !== target))} /><span><strong>{RETENTION_DESCRIPTIONS[target].name}</strong><br />{RETENTION_DESCRIPTIONS[target].scope}<br /><span className="text-muted-foreground">{RETENTION_DESCRIPTIONS[target].retained}</span></span></label>)}</fieldset>
    {!review ? <button type="button" disabled={!selected.length || pending} className="text-xs underline" onClick={() => setReview(true)}>Review removal of {selected.length} selected categories</button> : <div className="rounded border border-amber-400/30 p-3 space-y-2 text-xs"><p>Remove the selected local copies for the current account: {selected.map((target) => RETENTION_DESCRIPTIONS[target].name).join("; ")}. Saved server data, connected accounts and provider retention remain. Export anything needed before continuing.</p><label>Type CLEAR LOCAL DATA<input className="block w-full rounded border border-white/20 bg-transparent p-2 mt-1" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><div className="flex gap-3"><button type="button" disabled={confirmation !== "CLEAR LOCAL DATA" || pending} className="underline" onClick={() => void clear()}>{pending ? "Removing selected copies…" : "Clear selected local copies"}</button><button type="button" className="underline" disabled={pending} onClick={() => { setReview(false); setConfirmation(""); }}>Cancel</button></div></div>}
    {!!receipts.length && <ul className="text-xs space-y-2" role="status">{receipts.map((receipt) => <li key={receipt.target}>{receipt.state === "locally-cleared" ? "Local removal acknowledged" : "Partially completed"}: {receipt.detail}</li>)}</ul>}
    {error && <ResourceState phase="error" title="Retention action incomplete">{error}</ResourceState>}
    {receipts.some((receipt) => receipt.state === "failed") && <ResourceState phase="error" title="Some selected local copies could not be cleared">The category receipts above identify what completed. Review and select the failed categories before retrying; no removal is automatically repeated.</ResourceState>}
    <p className="text-xs text-muted-foreground">Server credentials and connector permissions are managed in Integrations. External providers, remote originals, backup systems and Windows/native storage have separate retention. This browser action makes no deletion claim for those environments.</p>
  </section>;
}
