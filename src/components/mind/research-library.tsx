import { useEffect, useRef, useState } from "react";
import type { SavedResearch } from "@/lib/mind/research-library.server";
import type { ResearchResult } from "@/lib/mind/research";

export function ResearchEvidence({ result }: { result: ResearchResult }) {
  function exportEvidence() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `research-evidence-${result.persistence?.reportId ?? "unsaved"}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section aria-label="Research evidence" className="space-y-3 rounded-xl border border-white/10 p-4">
    <div className="flex flex-wrap gap-2 text-xs text-white/60">
      <span>{result.report?.depth ?? "quick"} research</span>
      <span>Route: {result.route?.provider ?? "Not recorded"}</span>
      <span>Model: {result.route?.reportedModel ?? "Not reported"}</span>
      <span>{result.report?.attemptedQueries ?? 0} attempted · {result.report?.unattemptedQueries ?? 0} unattempted</span>
    </div>
    {result.persistence?.saved === false && <p role="alert" className="text-sm text-amber-200">{result.persistence.error}</p>}
    <button onClick={exportEvidence} className="text-xs underline">Export complete evidence</button>
    {result.providerAnswer && <details><summary className="cursor-pointer text-sm">Provider synthesis · source support requires review</summary><p className="mt-2 whitespace-pre-wrap text-sm text-white/80">{result.providerAnswer}</p></details>}
    {(result.evidence ?? []).map((source) => <details key={source.url} className="text-sm">
      <summary className="cursor-pointer">{source.title} <span className="text-white/50">· {source.status}</span></summary>
      <div className="mt-2 space-y-2 pl-3 text-white/70">
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="break-all underline">{source.url}</a>
        {source.excerpt && <blockquote className="border-l border-white/20 pl-3">{source.excerpt}</blockquote>}
        <p className="text-xs">{source.fetchedAt ? `Inspected ${new Date(source.fetchedAt).toLocaleString()}. This passage is evidence to assess, not verified fact.` : "Page contents have not been verified."}</p>
        {source.error && <p className="text-xs text-amber-200">{source.error}</p>}
      </div>
    </details>)}
    {!!result.report?.conflicts.length && <details><summary className="cursor-pointer text-sm">Qualifying passages requiring review ({result.report.conflicts.length})</summary><ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-white/70">{result.report.conflicts.map((item, index) => <li key={index}>{item.text}</li>)}</ul></details>}
    {!!result.report?.uncertainties.length && <details><summary className="cursor-pointer text-sm">Evidence limits</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-white/60">{result.report.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul></details>}
  </section>;
}

export function ResearchLibrary({ ownerKey, accessToken, onOpen, refreshKey = 0 }: { ownerKey: string | null; accessToken?: string | null; onOpen: (report: SavedResearch) => void; refreshKey?: number }) {
  const [items, setItems] = useState<SavedResearch[]>([]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [project, setProject] = useState("");
  const [archived, setArchived] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const epoch = useRef(0);
  const headers = () => ({ ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), "content-type": "application/json" });
  useEffect(() => { epoch.current++; setItems([]); setNextCursor(null); setError(""); }, [ownerKey]);
  async function load(before?: string) {
    if (!ownerKey) return;
    const generation = ++epoch.current;
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ q: query, tag, project, archived: archived ? "1" : "0", ...(before ? { before } : {}) });
      const response = await fetch(`/api/mind/research-reports?${params}`, { headers: headers(), credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Research library is unavailable.");
      if (generation !== epoch.current) return;
      setItems((old) => before ? [...old, ...data.items] : data.items); setNextCursor(data.nextCursor);
    } catch (caught) { if (generation === epoch.current) setError(caught instanceof Error ? caught.message : "Research library is unavailable."); }
    finally { if (generation === epoch.current) setBusy(false); }
  }
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [ownerKey, archived, version, refreshKey]);
  async function change(item: SavedResearch, fields: Record<string, unknown>, method = "PATCH") {
    const generation = epoch.current;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/mind/research-reports", { method, credentials: "same-origin", headers: headers(), body: JSON.stringify({ reportId: item.reportId, expectedRevision: item.revision, ...fields }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Report could not be changed.");
      if (generation === epoch.current) setVersion((value) => value + 1);
    } catch (caught) { if (generation === epoch.current) setError(caught instanceof Error ? caught.message : "Report could not be changed."); }
    finally { if (generation === epoch.current) setBusy(false); }
  }
  function exportReport(item: SavedResearch) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(item, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `research-${item.reportId}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section aria-label="Saved research library" className="space-y-3 rounded-xl border border-white/10 p-4">
    <h3 className="font-medium">Research library</h3>
    <p className="text-xs text-white/50">Saved to your account. Reports and their evidence remain until you delete them; archived reports remain searchable.</p>
    {!ownerKey ? <p className="text-sm">Sign in to load your reports.</p> : <>
      <form onSubmit={(event) => { event.preventDefault(); void load(); }} className="flex flex-wrap gap-2">
        <input aria-label="Search saved research" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search questions" className="min-w-40 flex-1 rounded border border-white/15 bg-transparent px-3 py-2 text-sm" />
        <input aria-label="Filter by research tag" value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Tag" className="w-28 rounded border border-white/15 bg-transparent px-3 text-sm" />
        <input aria-label="Filter by project identity" value={project} onChange={(event) => setProject(event.target.value)} placeholder="Project ID" className="w-32 rounded border border-white/15 bg-transparent px-3 text-sm" />
        <button disabled={busy} type="submit" className="rounded border border-white/15 px-3 py-2 text-sm">Search</button>
      </form>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} /> Show archived</label>
      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
      {items.map((item) => <article key={item.reportId} className="space-y-2 rounded-lg border border-white/10 p-3">
        <button className="text-left text-sm font-medium underline" onClick={() => onOpen(item)}>{item.question}</button>
        <p className="text-xs text-white/50">Revision {item.revision} · {new Date(item.updatedAt).toLocaleString()} · {item.result.route?.provider ?? "Route not recorded"}</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <button onClick={() => exportReport(item)} className="underline">Export evidence</button>
          <button disabled={busy} onClick={() => void change(item, { archived: !item.archived })} className="underline">{item.archived ? "Restore" : "Archive"}</button>
          {item.archived && <button disabled={busy} onClick={() => { if (window.confirm("Permanently delete this report and all its saved revisions?")) void change(item, {}, "DELETE"); }} className="underline">Delete permanently</button>}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void change(item, { tags: String(data.get("tags") ?? "").split(",").map((part) => part.trim()).filter(Boolean), projectId: String(data.get("project") ?? "").trim() || null }); }} className="flex flex-wrap gap-2">
          <input key={`${item.reportId}-tags-${item.revision}`} name="tags" aria-label={`Tags for ${item.question}`} defaultValue={item.tags.join(", ")} placeholder="Tags, separated by commas" className="min-w-40 flex-1 rounded border border-white/10 bg-transparent px-2 py-1 text-xs" />
          <input key={`${item.reportId}-project-${item.revision}`} name="project" aria-label={`Project for ${item.question}`} defaultValue={item.projectId ?? ""} placeholder="Project ID" className="w-32 rounded border border-white/10 bg-transparent px-2 py-1 text-xs" />
          <button disabled={busy} type="submit" className="text-xs underline">Save labels</button>
        </form>
      </article>)}
      {!busy && !items.length && !error && <p className="text-sm text-white/50">No saved reports match these filters.</p>}
      {nextCursor && <button disabled={busy} onClick={() => void load(nextCursor)} className="text-sm underline">Load more reports</button>}
      {busy && <p role="status" className="text-xs text-white/50">Loading research…</p>}
    </>}
  </section>;
}
