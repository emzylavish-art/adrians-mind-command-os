import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { LocalFile, Workspace } from "@/lib/mind/types";
import { adoptBotConfiguration, botConversationRevision, canonical, deleteProject, pushAudit, setProjectArchived } from "@/lib/mind/workspace";
import { documentCopyDisclosure } from "@/lib/mind/knowledge";
import { readDocumentOriginal, removeDocumentOriginal } from "@/lib/mind/document-originals";

type Confirmation = { title: string; detail: string; confirm: string; run: () => void | Promise<void> };
const button = "min-h-11 rounded-panel border border-line px-3 py-2 text-sm";

export function PdfSourceLocations({ index }: { index: NonNullable<LocalFile["evidenceIndex"]> }) {
  return <details className="rounded-panel border border-line p-3"><summary className="cursor-pointer">PDF source locations · {index.kind === "pdf-page-tree" ? `${index.pageCount} ordered pages` : "page attribution unavailable"}</summary><p className="mt-2">Offsets refer to the retained extracted text, not PDF byte positions. Extracted characters: {index.extractedCharacters.toLocaleString()}; retained: {index.retainedCharacters.toLocaleString()}. Missing or scanned text requires OCR; no page contents are invented.</p><p className="mt-2 break-all">Original checksum: {index.sourceSha256}</p><ul className="mt-2 max-h-64 space-y-1 overflow-auto">{index.pages.map((page) => <li key={page.page}>Page {page.page}: {page.coverage} · characters {page.start}–{page.end}</li>)}</ul></details>;
}

/** Account-owned knowledge controls; actions use the same local protected-review pattern. */
export function KnowledgeSettings({ ws, setWs, activeChatId, owner }: {
  ws: Workspace;
  setWs: Dispatch<SetStateAction<Workspace>>;
  activeChatId: string | null;
  owner: string | null;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Confirmation | null>(null);
  const [selected, setSelected] = useState("");
  const identity = useRef(owner);
  identity.current = owner;
  const current = useRef(ws);
  current.current = ws;
  useEffect(() => { setPending(null); setSelected(""); setNotice(null); }, [owner]);
  const chat = ws.chats.find((item) => item.id === activeChatId);
  const revision = chat?.agentId ? botConversationRevision(ws, chat) : null;
  const file = ws.files.find((item) => item.id === selected);

  async function downloadOriginal(item: LocalFile) {
    if (!owner || !item.original) return;
    const capturedOwner = owner;
    try {
      const data = await readDocumentOriginal(capturedOwner, item.original.id, item.original.sha256);
      if (identity.current !== capturedOwner) return;
      if (!data) { setNotice("The original bytes are not on this browser. The extracted text and provenance remain available."); return; }
      const url = URL.createObjectURL(data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Downloaded the original stored on this browser after verifying its saved checksum.");
    } catch {
      if (identity.current === capturedOwner) setNotice("The original document could not be read. The Library record was kept.");
    }
  }

  function requestFileDeletion(item: LocalFile) {
    const capturedOwner = owner;
    const reviewed = canonical(item);
    setPending({ title: `Delete “${item.name}”`, confirm: "Delete Library copy", detail: `${documentCopyDisclosure(ws, item).message} Its retained original on this device will also be removed.`, run: async () => {
      if (identity.current !== capturedOwner || canonical(current.current.files.find((row) => row.id === item.id)) !== reviewed) { setNotice("The account or document changed. Review it again before deleting."); return; }
      if (capturedOwner && item.original && !current.current.files.some((row) => row.id !== item.id && row.original?.id === item.original!.id)) {
        try { await removeDocumentOriginal(capturedOwner, item.original.id); }
        catch {
          if (identity.current === capturedOwner) {
            setWs((value) => ({ ...value, files: value.files.map((row) => row.id === item.id ? { ...row, retrievalDisabled: true } : row) }));
            setNotice("Original-file deletion failed. Future retrieval is disabled and the record was kept so you can use Review removal to retry.");
          }
          return;
        }
      }
      if (identity.current !== capturedOwner) return;
      if (canonical(current.current.files.find((row) => row.id === item.id)) !== reviewed) { setNotice("The document changed during removal. Its Library record was kept; review it again."); return; }
      setWs((value) => pushAudit({ ...value, files: value.files.filter((row) => row.id !== item.id) }, "delete_file", item.id, "Library copy removed; conversation copies retained"));
      setSelected("");
      setNotice("Library copy removed. Existing conversation copies remain separate.");
    } });
  }

  function projectReviewSnapshot(id: string) {
    const value = current.current;
    return canonical({ project: value.projects.find((item) => item.id === id), agents: value.agents.filter((item) => item.projectId === id), files: value.files.filter((item) => item.projectId === id).map((item) => item.id), chats: value.chats.filter((item) => item.projectId === id).map((item) => item.id) });
  }

  return <section className="mt-4 space-y-4 rounded-panel border border-line bg-surface p-4" aria-labelledby="knowledge-settings-title">
    <div><h3 id="knowledge-settings-title" className="font-semibold">Project knowledge and retained copies</h3><p className="mt-1 text-sm text-muted">Project document access is a separate conversation choice. Only retrieved passages are sent; storing a file does not mean a model has read it.</p></div>
    {notice && <p role="status" className="rounded-panel border border-line p-3 text-sm">{notice}</p>}
    {chat && revision && <div className="rounded-panel border border-line p-3 text-sm">
      <p>Current bot conversation: <strong>{chat.title}</strong></p>
      <p>Conversation revision: {revision.pinned ?? "Legacy — not recorded"}. Current bot revision: {revision.current ?? "Unavailable"}.</p>
      {revision.requiresReview && <p className="mt-1 text-muted">This conversation keeps its prior instructions. Revoked permissions still apply immediately. Review the current bot before adopting its newer settings.</p>}
      {revision.requiresReview && !revision.unavailable && <button className={`${button} mt-2`} onClick={() => {
        const agent = ws.agents.find((item) => item.id === chat.agentId)!;
        const reviewed = canonical(agent);
        setPending({ title: `Update “${chat.title}” to bot revision ${agent.version}`, detail: "Adopt the current bot instructions, model choice, copied knowledge, memory setting and project. Existing messages are retained. This does not rewrite an active run.", confirm: "Adopt reviewed revision", run: () => {
          if (identity.current !== owner || canonical(current.current.agents.find((item) => item.id === agent.id)) !== reviewed) { setNotice("The bot or account changed. Review the new revision again."); return; }
          setWs((value) => adoptBotConfiguration(value, chat.id));
          setNotice("This conversation now uses the reviewed bot revision. Existing messages were retained.");
        } });
      }}>Review and adopt current bot</button>}
    </div>}
    <details className="rounded-panel border border-line p-3"><summary className="min-h-11 content-center cursor-pointer text-sm font-semibold">Project lifecycle ({ws.projects.length})</summary>
      <ul className="mt-3 space-y-2">{ws.projects.map((project) => <li key={project.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="mr-auto">{project.name}{project.archived ? " · Archived" : ""}</span>
        <button className={button} onClick={() => setWs((value) => setProjectArchived(value, project.id, !project.archived))}>{project.archived ? "Restore project" : "Archive project"}</button>
        <button className={button} onClick={() => {
          const reviewed = projectReviewSnapshot(project.id);
          const affected = ws.agents.filter((item) => item.projectId === project.id).length;
          setPending({ title: `Delete project “${project.name}”`, detail: `Chats and files remain but are unlinked. ${affected} associated agent(s) will be archived and their schedules disabled. Project notes retain their original private scope. Execution history is retained. Archive instead to preserve all associations.`, confirm: "Delete reviewed project", run: () => {
            if (identity.current !== owner || projectReviewSnapshot(project.id) !== reviewed) { setNotice("This project or its resources changed. Review the affected resources again."); return; }
            setWs((value) => pushAudit(deleteProject(value, project.id), "delete_project", project.id, "unlinked resources; agents archived; schedules disabled"));
            setNotice("Project removed. Associated agents were archived and schedules disabled; existing records were preserved.");
          } });
        }}>Review deletion</button>
      </li>)}</ul>
    </details>
    <label className="block text-sm">Inspect a document<select className="mt-1 min-h-11 w-full rounded-panel border border-line bg-bg px-3" value={selected} onChange={(event) => { setSelected(event.target.value); setNotice(null); }}><option value="">Choose a Library document</option>{ws.files.map((item) => <option key={item.id} value={item.id}>{item.name}{item.archived ? " (prior revision)" : ""}</option>)}</select></label>
    {file && <div className="space-y-2 rounded-panel border border-line p-3 text-sm">
      <h4 className="font-semibold">{file.name} · Revision {file.revision ?? "legacy"}</h4>
      <p>Extracted text: {file.text.length.toLocaleString()} characters{file.partial ? " · Partial extraction" : ""}. {file.extraction?.method ?? "Legacy extraction method unknown"}.</p>
      {file.extraction?.coverage && <p>{file.extraction.coverage}</p>}
      {file.evidenceIndex && <PdfSourceLocations index={file.evidenceIndex} />}
      <p className="break-all">Text checksum: {file.textSha256 ?? "Not recorded for this legacy copy"}</p>
      <p>{file.original ? `Original: ${file.original.bytes.toLocaleString()} bytes, stored on the originating browser. Account sync and JSON archives contain its reference, not its original bytes.` : "No retained original is recorded; this is an extracted text copy."}</p>
      <p>{documentCopyDisclosure(ws, file).message}</p>
      <div className="flex flex-wrap gap-2">
        {file.original && <button className={button} onClick={() => void downloadOriginal(file)}>Download original on this browser</button>}
        <button className={button} onClick={() => setWs((value) => ({ ...value, files: value.files.map((item) => item.id === file.id ? { ...item, retrievalDisabled: !item.retrievalDisabled } : item) }))}>{file.retrievalDisabled ? "Allow future project retrieval" : "Exclude from future retrieval"}</button>
        <button className={button} onClick={() => requestFileDeletion(file)}>Review removal</button>
      </div>
    </div>}
    <AlertDialog.Root open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }}><AlertDialog.Portal>
      <AlertDialog.Overlay className="fixed inset-0 z-[130] bg-black/50" />
      <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[131] w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 rounded-panel border border-line bg-surface p-5 shadow-xl">
        <AlertDialog.Title className="font-semibold">{pending?.title}</AlertDialog.Title>
        <AlertDialog.Description className="mt-2 text-sm text-muted">{pending?.detail}</AlertDialog.Description>
        <div className="mt-4 flex flex-wrap justify-end gap-2"><AlertDialog.Cancel className={button}>Cancel</AlertDialog.Cancel><AlertDialog.Action className={button} onClick={() => void pending?.run()}>{pending?.confirm}</AlertDialog.Action></div>
      </AlertDialog.Content>
    </AlertDialog.Portal></AlertDialog.Root>
  </section>;
}
