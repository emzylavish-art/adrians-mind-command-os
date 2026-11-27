import { useEffect, useRef, useState } from "react";
import type { LocalFile, Project } from "@/lib/mind/types";
import { accountOriginalFileStore, parseCsvPreview, prepareLibraryDocument, readAccountOriginal, originalKey, replaceLibraryDocument, restoreLibraryVersion } from "@/lib/mind/library-documents";
import { extractPdfText, selectPdfChunks } from "@/lib/mind/pdf-text";
import { MarkdownProse } from "./markdown-prose";
import { ResourceState } from "./resource-state";

export function LibraryDocumentPreview({ file, ownerId, projects, onChange, onOpenSource }: {
  file: LocalFile; ownerId: string; projects: Project[];
  onChange: (next: LocalFile, expectedVersion: string) => void;
  onOpenSource?: (chatId: string) => void;
}) {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const [originalAttempt, setOriginalAttempt] = useState(0);
  const [rename, setRename] = useState(file.name);
  const [format, setFormat] = useState<"preview" | "text">("preview");
  const [passageQuery, setPassageQuery] = useState("");
  const passages = file.document && passageQuery.trim()
    ? selectPdfChunks(file.document, { query: passageQuery, maxChars: 3500 })
    : null;
  const current = useRef({ ownerId, fileId: file.id, versionId: file.versionId || file.id });
  current.current = { ownerId, fileId: file.id, versionId: file.versionId || file.id };
  useEffect(() => { setRename(file.name); setFormat("preview"); }, [file.id, file.name]);
  useEffect(() => { setWorking(false); }, [ownerId, file.id, file.versionId]);
  useEffect(() => {
    let active = true; let url: string | null = null;
    setOriginalUrl(null); setError(null); setLoadingOriginal(false);
    if (!file.original || !ownerId) return;
    setLoadingOriginal(true);
    void readAccountOriginal(file, ownerId).then((blob) => {
      if (!active) return;
      url = URL.createObjectURL(blob); setOriginalUrl(url);
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Original unavailable on this device."); }).finally(() => { if (active) setLoadingOriginal(false); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [ownerId, file.id, file.original && originalKey(file.original), file.original?.sha256, originalAttempt]);
  const expectedVersion = file.versionId || file.id;
  const isImage = /^image\/(?:png|jpeg|gif|webp)$/.test(file.original?.mime || "");
  const isPdf = file.original?.mime === "application/pdf" || /\.pdf$/i.test(file.name);
  const csv = /\.csv$/i.test(file.name) ? parseCsvPreview(file.text) : null;
  let json: string | null = null;
  if (/\.json$/i.test(file.name)) { try { json = JSON.stringify(JSON.parse(file.text), null, 2); } catch { /* Show honest text fallback. */ } }
  const downloadText = () => {
    const url = URL.createObjectURL(new Blob([file.text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${file.name}.extracted.txt`; link.click(); URL.revokeObjectURL(url);
  };
  const replace = async (picked: File | undefined) => {
    if (!picked || working) return;
    const scope = { ...current.current };
    const isCurrent = () => scope.ownerId === current.current.ownerId && scope.fileId === current.current.fileId && scope.versionId === current.current.versionId;
    setWorking(true); setError(null);
    try {
      const next = await prepareLibraryDocument(picked, { projectId: file.projectId, store: accountOriginalFileStore(ownerId), extractPdf: extractPdfText, isCurrent });
      if (isCurrent()) onChange(replaceLibraryDocument(file, next), scope.versionId);
    } catch (caught) { if (isCurrent()) setError(caught instanceof Error ? caught.message : "Replacement could not be saved. The previous file was kept."); }
    finally { if (isCurrent()) setWorking(false); }
  };
  return <section className="min-w-0 space-y-3" aria-label={`Document ${file.name}`}>
    {file.document && <details>
      <summary>Search extracted PDF passages</summary>
      <label className="block py-2">Page or search terms
        <input type="search" value={passageQuery} className="block w-full rounded-panel border border-line p-2" onChange={(event) => setPassageQuery(event.target.value)} />
      </label>
      {passages && <><p className="text-xs text-muted">{passages.coverage}</p><pre className="whitespace-pre-wrap break-words text-sm">{passages.text}</pre></>}
    </details>}
    <div className="flex flex-wrap gap-2">
      {originalUrl ? <a className="inline-flex min-h-11 items-center rounded-panel border border-line px-3 text-sm" href={originalUrl} download={(file.original && "name" in file.original && file.original.name) || file.name}>Download original · {file.original?.bytes.toLocaleString()} bytes</a> : null}
      <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={downloadText} disabled={!file.text}>Download extracted text</button>
      <label className="inline-flex min-h-11 cursor-pointer items-center rounded-panel border border-line px-3 text-sm">{working ? "Saving replacement…" : "Upload new version"}<input type="file" className="sr-only" disabled={working} onChange={(event) => { void replace(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
      {file.sourceChatId && onOpenSource ? <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => onOpenSource(file.sourceChatId!)}>Open source conversation</button> : null}
    </div>
    <p className="text-sm text-muted">{file.original ? "Original bytes are saved on this device for this account. Workspace archives include a reference, not the original file." : "This legacy entry contains a text copy. Its original file was not preserved."} {typeof file.extraction === "string" ? file.extraction : file.extraction?.coverage} {file.partial ? "The text preview is partial; inspect the original for complete coverage." : ""}</p>
    {(loadingOriginal || working) && <ResourceState phase="loading" title={working ? "Saving the new document version" : "Loading the original document"}>{working ? "The previous version remains available until the replacement is saved." : "Reading this account's local copy. The extracted preview remains available below."}</ResourceState>}
    {error ? <ResourceState phase="error" title="Document action incomplete" action={file.original && !working ? { label: "Retry reading original", run: () => setOriginalAttempt((value) => value + 1) } : undefined}>{error}</ResourceState> : null}
    {!loadingOriginal && !working && !error && !file.text && !originalUrl && <ResourceState phase="empty" title="No document preview available">This entry has no extracted text or original available on this device. Upload an original as a new version to recover it.</ResourceState>}
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Name<input aria-label="Document name" value={rename} maxLength={200} onChange={(event) => setRename(event.target.value)} className="ml-2 min-h-11 rounded-panel border border-line bg-bg px-2" /></label>
      <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={!rename.trim() || rename.trim() === file.name} onClick={() => onChange({ ...file, name: rename.trim(), updatedAt: new Date().toISOString() }, expectedVersion)}>Rename</button>
      <label className="text-sm">Project<select aria-label="Document project" value={file.projectId || ""} onChange={(event) => onChange({ ...file, projectId: event.target.value || null }, expectedVersion)} className="ml-2 min-h-11 rounded-panel border border-line bg-bg px-2"><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" aria-pressed={format === "text"} onClick={() => setFormat((value) => value === "text" ? "preview" : "text")}>{format === "text" ? "Formatted preview" : "Extracted text"}</button>
    </div>
    {format === "preview" && originalUrl && isImage ? <img src={originalUrl} alt={file.name} className="max-h-[65vh] max-w-full object-contain" /> : format === "preview" && originalUrl && isPdf ? <iframe title={`Original PDF ${file.name}`} src={originalUrl} sandbox="" className="h-[65vh] w-full rounded-panel border border-line" /> : format === "preview" && csv ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><tbody>{csv.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => index === 0 ? <th scope="col" key={column} className="border border-line p-2">{cell}</th> : <td key={column} className="border border-line p-2">{cell}</td>)}</tr>)}</tbody></table>{csv.truncated || csv.malformed ? <p className="text-sm text-muted">Preview limited to 100 rows and 20 columns. {csv.malformed ? "An unclosed quoted field was found." : ""} Download the original for the full document.</p> : null}</div> : format === "preview" && /\.md$/i.test(file.name) ? <MarkdownProse text={file.text} /> : <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-panel bg-surface-2 p-4 font-mono text-xs">{json || file.text || "No text was extracted. Use the original file."}</pre>}
    {file.versions?.length ? <details><summary className="min-h-11 cursor-pointer text-sm">Version history · {file.versions.length} previous {file.versions.length === 1 ? "version" : "versions"}</summary><ul className="space-y-3">{file.versions.map((version) => <li key={version.versionId} className="rounded-panel border border-line p-3"><p className="text-sm">{version.name} · {version.at} · {version.bytes.toLocaleString()} bytes</p><details><summary className="min-h-11 cursor-pointer text-sm">Compare saved text</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{version.text || "No extracted text in this version."}</pre></details><button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => { const restored = restoreLibraryVersion(file, version.versionId); if (restored) onChange(restored, expectedVersion); }}>Restore as a new version</button></li>)}</ul></details> : null}
  </section>;
}
