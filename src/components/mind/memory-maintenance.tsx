import { useState } from "react";
import type { MemoryItem } from "@/lib/mind/types";
import { memoryMaintenance } from "@/lib/mind/memory/maintenance";

export function MemoryMaintenance({ items, onUpdate, onOpen }: { items: MemoryItem[]; onUpdate: (id: string, patch: Partial<MemoryItem>, expectedUpdatedAt: string) => void; onOpen?: (id: string) => void }) {
  const [tag, setTag] = useState("");
  const report = memoryMaintenance(items);
  const visible = items.filter((item) => !item.archived && (!tag || item.tags?.some((value) => value.toLowerCase().includes(tag.toLowerCase()))));
  return <details className="rounded-xl border border-white/10 p-4 text-sm"><summary className="cursor-pointer">Memory review · {report.duplicates.length} duplicate groups · {report.dueReviewIds.length} reviews due</summary>
    <p className="text-xs text-muted-foreground my-2">Duplicates are matched only within the same scope. Nothing is merged, deleted or approved automatically.</p>
    <input className="rounded border border-white/10 bg-transparent px-2 py-1 mb-2" aria-label="Filter memory by tag" value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Filter by tag" />
    {report.duplicates.map((ids) => <p key={ids[0]} className="text-xs">Duplicate notes: {ids.map((id) => <button key={id} type="button" className="underline mr-2" onClick={() => onOpen?.(id)}>{items.find((item) => item.id === id)?.text.slice(0, 45) ?? id}</button>)}</p>)}
    <div className="max-h-80 overflow-auto space-y-3 mt-3">{visible.map((item) => <div key={item.id} className="border-t border-white/10 pt-2"><p className="truncate">{item.text}</p><div className="flex flex-wrap gap-2 mt-2">
      <label className="text-xs">Authority <select className="bg-background border border-white/10 rounded p-1" aria-label={`Authority for ${item.text.slice(0, 30)}`} value={item.authority ?? "unreviewed"} onChange={(event) => onUpdate(item.id, { authority: event.target.value as MemoryItem["authority"] }, item.updatedAt)}><option value="unreviewed">Unreviewed</option><option value="owner-approved">Owner approved</option><option value="historical">Historical</option></select></label>
      <label className="text-xs">Review on <input className="bg-transparent border border-white/10 rounded p-1" type="date" defaultValue={item.reviewAt?.slice(0, 10) ?? ""} key={`${item.id}:${item.reviewAt}`} onBlur={(event) => { const value = event.target.value; if (value !== (item.reviewAt?.slice(0, 10) ?? "")) onUpdate(item.id, { reviewAt: value ? `${value}T00:00:00.000Z` : undefined }, item.updatedAt); }} /></label>
      <label className="text-xs">Tags <input className="bg-transparent border border-white/10 rounded p-1" defaultValue={item.tags?.join(", ") ?? ""} key={`${item.id}:${item.tags?.join(",")}`} onBlur={(event) => { const tags = event.target.value.split(",").map((value) => value.trim()).filter(Boolean); if (tags.join(",") !== (item.tags ?? []).join(",")) onUpdate(item.id, { tags }, item.updatedAt); }} /></label>
    </div><p className="text-xs text-muted-foreground mt-1">{item.scope} · source {item.source}{item.sourceRef?.documentId ? ` · ${item.sourceRef.documentId}${item.sourceRef.section ? `/${item.sourceRef.section}` : ""}` : ""}{report.dueReviewIds.includes(item.id) ? " · review due" : ""}</p></div>)}</div>
  </details>;
}
