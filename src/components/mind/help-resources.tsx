import { useState } from "react";
import { LOCAL_BUILD, LOCAL_VERSION, PUBLIC_INSTALLER } from "@/lib/mind/desktop-update";
import { ADRIAN_REPOSITORY, bugAreas, bugSymptoms, previewBugReport, publishedPolicyUrl, revisionLabel } from "@/lib/mind/help-resources";

const section = "space-y-2 rounded-panel border border-line bg-surface p-4 text-sm";
const link = "inline-flex min-h-11 items-center text-accent underline underline-offset-4";
const field = "min-h-11 rounded-panel border border-line bg-bg px-3";
const extern = { target: "_blank", rel: "noopener noreferrer" } as const;
const revision = revisionLabel(import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA ?? import.meta.env.VITE_ADRIAN_REVISION);

export function HelpResources({ query, privacy, keyboard }: { query: string; privacy: () => void; keyboard: () => void }) {
  const match = (value: string) => value.toLowerCase().includes(query.trim().toLowerCase());
  const [area, setArea] = useState<string>(bugAreas[0]);
  const [symptom, setSymptom] = useState<string>(bugSymptoms[0]);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [copied, setCopied] = useState("");
  const diagnostics = includeDiagnostics && typeof window !== "undefined" ? {
    online: navigator.onLine, installed: window.matchMedia("(display-mode: standalone)").matches, revision,
  } : undefined;
  const report = previewBugReport(area, symptom, diagnostics);
  const documents = [
    { name: "Terms of Service", url: publishedPolicyUrl(import.meta.env.VITE_ADRIAN_TERMS_URL) },
    { name: "Privacy Policy", url: publishedPolicyUrl(import.meta.env.VITE_ADRIAN_PRIVACY_URL) },
  ];
  return <section aria-label="Help center resources" className="grid gap-3">
    {match("Privacy center data permissions export archive privacy policy") && <article className={section}>
      <h3 className="font-semibold">Privacy center</h3>
      <p className="text-muted">Manage workspace data, archived chats and exports.</p>
      <button type="button" className={link} onClick={privacy}>Open data controls</button>
    </article>}
    {match("Keyboard shortcuts keys bindings composer") && <article className={section}>
      <h3 className="font-semibold">Keyboard shortcuts</h3>
      <button type="button" className={link} onClick={keyboard}>Review and change shortcuts</button>
    </article>}
    {match("Release notes downloads download apps version build desktop Windows installer") && <article className={section}>
      <h3 className="font-semibold">Releases and downloads</h3>
      <p className="text-muted">Windows desktop · Version {LOCAL_VERSION} · Build {LOCAL_BUILD}</p>
      {revision && <p className="text-muted">Web revision <code>{revision}</code></p>}
      <div className="flex flex-wrap gap-x-5">
        <a className={link} href={PUBLIC_INSTALLER} {...extern}>Download Windows app</a>
        <a className={link} href={ADRIAN_REPOSITORY + "/releases"} {...extern}>Release notes</a>
      </div>
    </article>}
    {documents.filter(doc => match(doc.name + " legal documents")).map(doc => <article className={section} key={doc.name}>
      <h3 className="font-semibold">{doc.name}</h3>
      {doc.url ? <a className={link} href={doc.url} {...extern}>Read {doc.name}</a> : <p className="text-muted">The publisher has not supplied a {doc.name} link for this installation.</p>}
    </article>)}
    {match("Report a bug diagnostics support issue") && <details className={section}>
      <summary className="cursor-pointer py-2 font-semibold">Report a bug</summary>
      <div className="grid gap-3 pt-2">
        <label className="grid gap-1">Affected area<select className={field} value={area} onChange={event => { setArea(event.target.value); setCopied(""); }}>{bugAreas.map(label => <option key={label}>{label}</option>)}</select></label>
        <label className="grid gap-1">What happened?<select className={field} value={symptom} onChange={event => { setSymptom(event.target.value); setCopied(""); }}>{bugSymptoms.map(label => <option key={label}>{label}</option>)}</select></label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={includeDiagnostics} onChange={event => { setIncludeDiagnostics(event.target.checked); setCopied(""); }}/>Include device diagnostics</label>
        <h4 className="font-medium">Report preview</h4>
        <pre className="whitespace-pre-wrap break-words rounded-panel border border-line p-3 text-xs">{report.body}</pre>
        <p className="text-muted">Opening the draft passes the preview to GitHub. You can add reproduction steps and choose whether to submit it there.</p>
        <div className="flex flex-wrap gap-x-5">
          <a className={link} href={report.url} {...extern}>Open GitHub issue draft</a>
          <button type="button" className={link} onClick={async () => {
            try { await navigator.clipboard.writeText(report.body); setCopied("Report copied."); }
            catch { setCopied("Select and copy the report preview."); }
          }}>Copy report</button>
        </div>
        {copied && <p role="status">{copied}</p>}
      </div>
    </details>}
  </section>;
}
