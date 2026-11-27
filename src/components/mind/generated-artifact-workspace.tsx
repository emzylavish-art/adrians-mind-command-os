import { useEffect, useMemo, useRef, useState } from "react";
import { artifactImageCanBeUsed, artifactSourceIsCurrent, listGeneratedArtifacts, prepareArtifactDocument, resolveArtifactImage, type ArtifactImageSource, type GeneratedArtifact } from "@/lib/mind/generated-artifacts";
import { accountImageStore } from "@/lib/mind/media/blob-store";
import { accountOriginalFileStore } from "@/lib/mind/library-documents";
import { imageDownloadName } from "@/lib/mind/media/chat-gallery";
import type { LocalFile, Workspace } from "@/lib/mind/types";

export function GeneratedArtifactWorkspace({ ownerId, workspace, onOpenChat, onEditImage, onSaveArtifact }: { ownerId: string; workspace: Workspace; onOpenChat: (chatId: string, messageId?: string) => void; onEditImage?: (source: ArtifactImageSource) => void; onSaveArtifact: (file: LocalFile) => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }> }) {
  const [kind, setKind] = useState<GeneratedArtifact["kind"] | "all">("all");
  const [project, setProject] = useState("all");
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(24);
  const [active, setActive] = useState<string | null>(null);
  const [resolvedImage, setImage] = useState<{ artifact: GeneratedArtifact; source: ArtifactImageSource } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const owner = useRef(ownerId); owner.current = ownerId;
  const latestWorkspace = useRef(workspace); latestWorkspace.current = workspace;
  const generation = useRef(0);
  const artifacts = useMemo(() => listGeneratedArtifacts(workspace, { kind, ...(project === "all" ? {} : { projectId: project === "unassigned" ? null : project }), query }), [workspace, kind, project, query]);
  const chosen = artifacts.find((artifact) => artifact.id === active);
  const chosenRef = useRef(chosen); chosenRef.current = chosen;
  const chosenImage = chosen?.kind === "image" ? chosen.image : undefined;
  const image = resolvedImage && chosen?.id === resolvedImage.artifact.id && artifactImageCanBeUsed(workspace, resolvedImage.artifact, resolvedImage.source, ownerId) ? resolvedImage.source : null;
  useEffect(() => { generation.current++; setActive(null); setImage(null); setError(""); setNotice(""); setBusy(false); setCount(24); }, [ownerId, kind, project, query]);
  useEffect(() => {
    const selected = chosenRef.current;
    if (!selected || selected.kind !== "image") { setImage(null); return; }
    let cancelled = false;
    const account = ownerId; setImage(null); setError("");
    void resolveArtifactImage(selected, { ownerId: account, currentOwner: () => owner.current, currentWorkspace: () => latestWorkspace.current, getOwned: (id) => accountImageStore(account).getOwned(id) }).then((result) => { if (!cancelled && account === owner.current && artifactImageCanBeUsed(latestWorkspace.current, selected, result, account)) setImage({ artifact: selected, source: result }); }).catch((cause) => { if (!cancelled && account === owner.current) setError(cause instanceof Error ? cause.message : "The image could not be loaded."); });
    return () => { cancelled = true; };
  }, [chosen?.id, chosen?.kind, chosen?.name, chosen?.at, chosen?.provider, chosen?.model, chosen?.projectId, chosen?.replyVersionId, chosen?.selectedReplyVersionId, chosenImage?.blobId, chosenImage?.dataUrl, ownerId]);
  const imageForAction = () => {
    if (!resolvedImage || !chosen || chosen.id !== resolvedImage.artifact.id || !artifactImageCanBeUsed(latestWorkspace.current, resolvedImage.artifact, resolvedImage.source, owner.current)) { setImage(null); setError("The source image changed. Select the current image again."); return null; }
    return resolvedImage.source;
  };
  const save = async (artifact: GeneratedArtifact) => {
    const account = ownerId; const run = ++generation.current; setBusy(true); setError(""); setNotice("");
    try {
      const file = await prepareArtifactDocument(artifact, { ownerId: account, currentOwner: () => owner.current, store: accountOriginalFileStore(account), isCurrent: () => run === generation.current && artifactSourceIsCurrent(latestWorkspace.current, artifact) });
      if (run !== generation.current || account !== owner.current) return;
      const result = await onSaveArtifact(file);
      if (run !== generation.current || account !== owner.current) return;
      if (!result.ok) throw new Error(result.error || "The Library entry was not saved. The original bytes remain on this device.");
      setNotice("Saved to Library with original bytes and source conversation references.");
    } catch (cause) { if (run === generation.current && account === owner.current) setError(cause instanceof Error ? cause.message : "The artifact was not saved."); }
    finally { if (run === generation.current && account === owner.current) setBusy(false); }
  };
  const downloadText = (artifact: GeneratedArtifact) => {
    if (artifact.kind !== "code" && artifact.kind !== "document") return;
    const url = URL.createObjectURL(new Blob([artifact.text], { type: artifact.kind === "document" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = artifact.name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="space-y-3 rounded-xl border border-white/10 p-4" aria-labelledby="generated-artifact-heading"><h3 id="generated-artifact-heading" className="font-medium">Media and generated artifacts</h3><p className="text-xs text-muted-foreground">Completed saved replies, their retained versions, images and video references. Interrupted response fragments are excluded. These are source references until you explicitly save a document; code is never executed by this viewer. Temporary chats are excluded from this persistent workspace.</p>
    <div className="flex flex-wrap gap-2 text-xs"><select className="bg-background border border-white/10 rounded p-2" aria-label="Artifact type" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>{["all", "image", "video", "code", "document"].map((value) => <option key={value}>{value}</option>)}</select><select className="bg-background border border-white/10 rounded p-2 max-w-full" aria-label="Artifact project" value={project} onChange={(event) => setProject(event.target.value)}><option value="all">All projects</option><option value="unassigned">Unassigned</option>{workspace.projects.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select><input className="bg-transparent border border-white/10 rounded p-2 flex-1 min-w-0" aria-label="Filter artifacts" placeholder="Filter by name, chat or model" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <p className="text-xs text-muted-foreground">{artifacts.length} matching artifacts</p><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">{artifacts.slice(0, count).map((artifact) => <button key={artifact.id} type="button" className={`text-left rounded border p-3 ${active === artifact.id ? "border-primary" : "border-white/10"}`} onClick={() => { setActive(artifact.id); setNotice(""); setError(""); }}><p className="text-xs uppercase text-muted-foreground">{artifact.kind}{artifact.replyVersionId ? " · previous reply version" : ""}</p><p className="truncate text-sm">{artifact.name}</p><p className="text-xs text-muted-foreground truncate">{artifact.chatTitle} · {artifact.at}</p></button>)}</div>
    {count < artifacts.length && <button type="button" className="text-xs underline" onClick={() => setCount((current) => current + 24)}>Show more artifacts</button>}
    {chosen && <article className="rounded-lg border border-white/10 p-3 space-y-3"><div className="flex flex-wrap justify-between gap-2"><h4 className="text-sm font-medium">{chosen.name}</h4><button type="button" className="text-xs underline" onClick={() => { setActive(null); setImage(null); }}>Close preview</button></div><p className="text-xs text-muted-foreground">Source: {chosen.chatTitle} / {chosen.messageId}{chosen.replyVersionId ? ` / version ${chosen.replyVersionId}` : ""}. {chosen.provider || "Provider not recorded"} · {chosen.model || "Model not recorded"}. {chosen.kind === "image" && chosen.image.preparation ? `Original ${chosen.image.preparation.originalWidth} × ${chosen.image.preparation.originalHeight}; prepared ${chosen.image.preparation.width} × ${chosen.image.preparation.height}.` : ""}</p><button type="button" className="text-xs underline" onClick={() => onOpenChat(chosen.chatId, chosen.messageId)}>Open source conversation</button>
      {chosen.kind === "image" && image && <><img src={image.dataUrl} alt={image.name} className="max-h-[32rem] max-w-full object-contain rounded" /><div className="flex flex-wrap gap-3 text-xs">{imageDownloadName(image.dataUrl, image.name) && <a className="underline" href={image.dataUrl} download={imageDownloadName(image.dataUrl, image.name)!} onClick={(event) => { if (!imageForAction()) event.preventDefault(); }}>Download image</a>}{onEditImage && <button type="button" className="underline" onClick={() => { const source = imageForAction(); if (source) onEditImage(source); }}>Use as image-edit source</button>}</div><p className="text-xs text-muted-foreground">Uses the existing authorized bytes. Choosing an edit source does not claim a new generation succeeded.</p></>}
      {chosen.kind === "video" && <><video controls preload="none" src={chosen.url} className="max-h-[32rem] max-w-full" /><a href={chosen.url} target="_blank" rel="noreferrer" className="text-xs underline">Open original video link</a><p className="text-xs text-muted-foreground">This provider URL may expire. A listed link does not establish a durable downloaded copy.</p></>}
      {(chosen.kind === "code" || chosen.kind === "document") && <><pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-3 text-xs">{chosen.text}</pre><div className="flex gap-3 text-xs"><button type="button" className="underline" onClick={() => downloadText(chosen)}>Download {chosen.kind === "code" ? "code" : "Markdown"}</button><button type="button" className="underline" disabled={busy} onClick={() => void save(chosen)}>{busy ? "Saving original…" : "Save document to Library"}</button></div></>}
    </article>}
    {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}{notice && <p role="status" className="text-xs">{notice}</p>}
  </section>;
}
