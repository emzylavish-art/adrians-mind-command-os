import { useState } from "react";

export type GitReport = {
  repo?: boolean;
  branch?: string;
  status?: string;
  diff?: string;
  untracked?: string;
  log?: string;
  notice?: string;
  error?: string;
};

export function GitReview({ report, busy, onRead, onInit, onCommit, onBranch, onOpen }: { report: GitReport | null; busy: boolean; onRead: () => void; onInit: () => void; onCommit: (message: string) => void; onBranch: (name: string) => void; onOpen: (path: string) => void }) {
  const [message, setMessage] = useState("");
  const [branch, setBranch] = useState("");
  const files = `${report?.status || ""}\n${report?.untracked || ""}`.split("\n").flatMap((line) => {
    const path = line.trim().replace(/^[A-Z?]{1,2}\s+/, "");
    return path && path !== line.trim() && !path.startsWith("##") ? [path] : [];
  });
  return (
    <div className="space-y-2 rounded-panel border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={onRead} className="min-h-10 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Read Git</button>
        <button type="button" disabled={busy} onClick={onInit} className="min-h-10 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Start local Git</button>
        <span className="text-xs text-muted">{report?.branch ? `Branch ${report.branch}` : "No branch read yet"}</span>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); onCommit(message); }}>
        <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Local commit message" aria-label="Local commit message" className="min-h-10 min-w-40 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm" />
        <button type="submit" disabled={busy || !message.trim()} className="min-h-10 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink disabled:opacity-50">Commit locally</button>
      </form>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); onBranch(branch); }}>
        <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="local-branch" aria-label="Local branch name" className="min-h-10 min-w-40 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm" />
        <button type="submit" disabled={busy || !branch.trim()} className="min-h-10 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Create local branch</button>
      </form>
      <p className="text-xs text-muted">{report?.notice || report?.error || "Read-only local Git. It does not commit, push, or deploy."}</p>
      {files.length ? <div className="flex flex-wrap gap-2">{files.map((path) => <button key={path} type="button" onClick={() => onOpen(path)} className="min-h-10 rounded-panel border border-line px-2 text-xs">{path}</button>)}</div> : null}
      {report?.status ? <pre className="whitespace-pre-wrap font-mono text-xs">{report.status}</pre> : null}
      {report?.untracked ? <pre className="whitespace-pre-wrap font-mono text-xs text-muted">{report.untracked}</pre> : null}
      {report?.diff ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs">{report.diff}</pre> : null}
      {report?.log ? <pre className="whitespace-pre-wrap font-mono text-xs text-muted">{report.log}</pre> : null}
    </div>
  );
}
