import { useEffect, useRef, useState } from "react";
import { accountKnowledgeStore, indexKnowledgeDocument, knowledgeReadiness, retrieveKnowledge, type KnowledgeIndex } from "@/lib/mind/knowledge-index";
import { accountOriginalFileStore, prepareLibraryDocument, readVerifiedOriginal } from "@/lib/mind/library-documents";
import type { LocalFile } from "@/lib/mind/types";
import { ResourceState } from "./resource-state";

export function KnowledgeCollectionPanel({ ownerId, projectId, selectedIds = [], onSelection, onAddLibraryFile }: { ownerId: string; projectId: string | null; selectedIds?: string[]; onSelection?: (ids: string[]) => void; onAddLibraryFile?: (file: LocalFile) => void }) {
  const [index, setIndex] = useState<KnowledgeIndex>({ ownerId, documents: [] });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const current = useRef({ ownerId, projectId, selectedIds, onSelection, onAddLibraryFile }); current.current = { ownerId, projectId, selectedIds, onSelection, onAddLibraryFile };
  const generation = useRef(0);
  const refresh = async () => { const owner = current.current.ownerId; const run = ++generation.current; setLoading(true); try { const next = await accountKnowledgeStore(owner).list(); if (owner === current.current.ownerId && run === generation.current) { setIndex(next); setError(""); } } catch (cause) { if (owner === current.current.ownerId && run === generation.current) setError(cause instanceof Error ? cause.message : "Knowledge storage is unavailable."); } finally { if (owner === current.current.ownerId && run === generation.current) setLoading(false); } };
  useEffect(() => { setIndex({ ownerId, documents: [] }); setPending(false); void refresh(); return () => { generation.current++; }; }, [ownerId]);
  const upload = async (file: File, replaceId?: string) => {
    if (pending || loading) return;
    const owner = current.current.ownerId; const destination = current.current.projectId; const run = ++generation.current;
    const previous = replaceId ? index.documents.find((document) => document.id === replaceId) : undefined;
    const isCurrent = () => run === generation.current && owner === current.current.ownerId && destination === current.current.projectId;
    setPending(true); setError("");
    try {
      if (!/\.(?:txt|md|markdown|csv|json|[cm]?[jt]sx?|py|css|html?|xml|ya?ml|toml|log|sql|rs|go|java)$/i.test(file.name) && !file.type.startsWith("text/")) throw new Error("Index a text document here. Other originals can be stored in Library; connecting or uploading them does not prove text indexing.");
      if (file.size > 2_000_000) throw new Error("This text document exceeds the local 2 MB indexing limit. Split it into named sections; the original was not changed.");
      const text = await file.text();
      if (text.includes("\u0000") || !text.trim()) throw new Error("This file has no usable plain text. It was not indexed.");
      if (!isCurrent()) return;
      const libraryFile = await prepareLibraryDocument(file, { projectId: destination, store: accountOriginalFileStore(owner), isCurrent });
      if (!isCurrent()) return;
      const document = indexKnowledgeDocument({ id: previous?.id ?? libraryFile.id, ownerId: owner, projectId: destination, title: file.name, revision: `${libraryFile.original!.sha256}:${crypto.randomUUID()}`, sourceModifiedAt: libraryFile.updatedAt!, text, original: libraryFile.original }, owner);
      await accountKnowledgeStore(owner).put(document, previous?.revision ?? null);
      if (!isCurrent()) return;
      setIndex((value) => ({ ownerId: owner, documents: [...value.documents.filter((entry) => entry.id !== document.id), document] }));
      if (!previous) current.current.onAddLibraryFile?.(libraryFile);
      current.current.onSelection?.([...new Set([...current.current.selectedIds, document.id])]);
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : "The document was not indexed."); }
    finally { if (isCurrent()) setPending(false); }
  };
  const remove = async (id: string) => {
    const owner = current.current.ownerId; const document = index.documents.find((entry) => entry.id === id); if (!document) return;
    setPending(true); setError("");
    try { await accountKnowledgeStore(owner).remove(id, document.revision); if (owner !== current.current.ownerId) return; setIndex((previous) => ({ ...previous, documents: previous.documents.filter((entry) => entry.id !== id) })); current.current.onSelection?.(current.current.selectedIds.filter((selected) => selected !== id)); }
    catch (cause) { if (owner === current.current.ownerId) setError(cause instanceof Error ? cause.message : "The index was not removed."); }
    finally { if (owner === current.current.ownerId) setPending(false); }
  };
  const download = async (id: string) => {
    const owner = current.current.ownerId; const document = index.documents.find((entry) => entry.id === id); if (!document) return;
    try { const blob = await readVerifiedOriginal(document, accountOriginalFileStore(owner)); if (owner !== current.current.ownerId) return; const url = URL.createObjectURL(blob); const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = document.original?.name ?? document.title; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (cause) { if (owner === current.current.ownerId) setError(cause instanceof Error ? cause.message : "The original could not be downloaded."); }
  };
  const documents = (index.ownerId === ownerId ? index.documents : []).filter((document) => document.projectId === null || document.projectId === projectId);
  const effectiveIds = onSelection ? selectedIds : documents.map((document) => document.id);
  const preview = query.trim() ? retrieveKnowledge(index, { ownerId, projectId, documentIds: effectiveIds, query }) : null;
  return <details className="rounded-xl border border-white/10 p-4 text-sm"><summary className="cursor-pointer">Knowledge collections · {documents.length} indexed on this device</summary>
    <p className="text-xs text-muted-foreground my-2">Original text files and a local passage index stay in this account's browser storage. Full text is indexed independently of Library's preview limit. No embeddings, provider calls or cloud synchronization are performed. References on another device need the original imported there. Removing an index leaves its independently saved original and Library entry intact.</p>
    <div className="flex gap-3 items-center"><label className="text-xs underline cursor-pointer">{pending ? "Saving index…" : "Add text document"}<input className="sr-only" type="file" disabled={pending || loading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /></label><button type="button" className="text-xs underline" disabled={pending || loading} onClick={() => void refresh()}>Refresh local index</button></div>
    {(loading || pending) && <ResourceState phase="loading" title={pending ? "Updating the local knowledge index" : "Loading this account's knowledge index"}>An indexed reference is ready only after local storage acknowledges it.</ResourceState>}
    {error && <ResourceState phase="error" title="Knowledge action incomplete" action={{ label: "Reload local index", run: () => { void refresh(); }, disabled: pending || loading }}>{error}</ResourceState>}
    {!loading && !pending && !error && documents.length === 0 && <ResourceState phase="empty" title="No indexed documents in this scope">Add a text document for this account or project. A reference from another device does not contain its original text here.</ResourceState>}
    <ul className="space-y-3 my-3 max-h-72 overflow-auto">{documents.map((document) => <li key={document.id} className="border-b border-white/10 pb-2"><div className="flex gap-2">{onSelection && <input type="checkbox" aria-label={`Use ${document.title} for this chat`} checked={selectedIds.includes(document.id)} onChange={(event) => onSelection(event.target.checked ? [...new Set([...selectedIds, document.id])] : selectedIds.filter((id) => id !== document.id))} />}<span>{document.title}</span></div><p className="text-xs text-muted-foreground">{document.status === "ready-local" ? "Full text indexed locally" : "Partial source text indexed"} · {document.chunks.length} passages · {document.projectId ? "project scoped" : "account scoped"} · indexed {document.indexedAt}</p><div className="flex gap-2 text-xs mt-1"><button type="button" className="underline" onClick={() => void download(document.id)}>Download original</button><label className="underline cursor-pointer">Replace indexed source<input className="sr-only" type="file" disabled={pending || loading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file, document.id); }} /></label><button type="button" className="underline" disabled={pending || loading} onClick={() => void remove(document.id)}>Remove local index</button></div></li>)}</ul>
    {knowledgeReadiness(index, selectedIds).filter((entry) => entry.status === "not-on-this-device").map((entry) => <p key={entry.id} className="text-xs text-amber-300">{entry.id}: {entry.error}</p>)}
    <input className="w-full rounded border border-white/10 bg-transparent p-2 text-xs" aria-label="Test knowledge retrieval locally" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Preview local retrieval; no model call" />
    {preview && <div className="text-xs mt-2"><p>{preview.passages.length} matching passages; {preview.omittedDocumentIds.length} selected documents contributed no passage. Keyword, identifier and local concept matching.</p>{preview.passages.map((passage) => <blockquote key={`${passage.documentId}:${passage.start}`} className="border-l border-white/20 pl-2 my-2"><p>{passage.documentTitle} · characters {passage.start}–{passage.end} · {passage.authority}</p><p className="whitespace-pre-wrap">{passage.quote}</p></blockquote>)}</div>}
  </details>;
}
