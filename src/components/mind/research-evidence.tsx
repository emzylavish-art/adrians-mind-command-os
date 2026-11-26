import { useState } from "react";
import { addResearchClaim, researchCoverage, type ResearchClaim, type ResearchReport } from "@/lib/mind/research-reports";

export function ResearchEvidence({ report, onChange }: { report: ResearchReport; onChange: (report: ResearchReport) => void }) {
  const [claim, setClaim] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [kind, setKind] = useState<ResearchClaim["kind"]>("interpretation");
  const [error, setError] = useState<string | null>(null);
  const exportReport = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ kind: "adrians-mind-research", format: 1, report }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `research-${report.id}-v${report.version || 1}.json`; link.click(); URL.revokeObjectURL(url);
  };
  return <section className="mt-4 space-y-3 rounded-panel border border-line p-3" aria-label="Research evidence">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">Version {report.version || 1} · {researchCoverage(report)}</p><button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={exportReport}>Export report and evidence</button></div>
    <p className="text-xs text-muted">Saved on this device. Search-result metadata does not establish that a full page was read or that a claim is independently verified.</p>
    <ul className="space-y-2">{report.citations.map((source) => <li key={source.url} className="rounded-panel border border-line p-2 text-sm"><a href={source.url} target="_blank" rel="noreferrer" className="text-accent underline">{source.title}</a><p className="text-xs text-muted">{source.retrievedAt ? `Search returned ${source.retrievedAt}` : "Retrieval time unknown"} · {source.publishedAt ? `Published ${source.publishedAt}` : "Publication date unknown"}</p>{source.excerpt ? <blockquote className="mt-2 border-l-2 border-line pl-2">Provider excerpt: {source.excerpt}</blockquote> : <p className="text-xs text-muted">No supporting passage was returned.</p>}</li>)}</ul>
    {report.claims?.length ? <ul className="space-y-2" aria-label="Claims and sources">{report.claims.map((entry) => <li key={entry.id} className="rounded-panel border border-line p-2"><p className="text-xs text-muted">{entry.kind} · {entry.kind === "provider-cited" ? "provider attribution; not independently verified" : "owner-reviewed relationship"}</p><p className="text-sm">{entry.text}</p><ul>{entry.sourceUrls.map((url) => <li key={url}><a className="text-xs text-accent underline" href={url} target="_blank" rel="noreferrer">{report.citations.find((source) => source.url === url)?.title || url}</a></li>)}</ul></li>)}</ul> : null}
    <details><summary className="min-h-11 cursor-pointer text-sm">Record a finding with supporting sources</summary>
      <label className="block text-sm">Finding<textarea rows={3} maxLength={4000} className="mt-1 w-full rounded-panel border border-line bg-bg p-2" value={claim} onChange={(event) => setClaim(event.target.value)} /></label>
      <label className="block text-sm">Evidence kind<select value={kind} onChange={(event) => setKind(event.target.value as ResearchClaim["kind"])} className="ml-2 min-h-11 rounded-panel border border-line bg-bg px-2"><option value="direct-evidence">Direct evidence</option><option value="interpretation">Interpretation</option><option value="hypothesis">Hypothesis</option></select></label>
      <fieldset className="space-y-1"><legend className="text-sm">Sources supporting this finding</legend>{report.citations.map((source) => <label key={source.url} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={sources.includes(source.url)} onChange={(event) => setSources((current) => event.target.checked ? [...current, source.url] : current.filter((url) => url !== source.url))} />{source.title}</label>)}</fieldset>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => { const next = addResearchClaim(report, { text: claim, sourceUrls: sources, kind }); if (!next) { setError("Write the finding and choose at least one supporting source, or mark it as a hypothesis."); return; } onChange(next); setClaim(""); setSources([]); setError(null); }}>Save evidence relationship</button>
    </details>
    {report.versions?.length ? <details><summary className="min-h-11 cursor-pointer text-sm">Earlier report versions ({report.versions.length})</summary>{report.versions.map((version) => <article key={version.version} className="mt-2 rounded-panel border border-line p-2"><h4 className="text-sm font-semibold">Version {version.version} · {version.at}</h4><p className="whitespace-pre-wrap text-sm">{version.summary || "No summary returned."}</p><p className="text-xs text-muted">{version.citations.length} sources retained with this version</p></article>)}</details> : null}
  </section>;
}
