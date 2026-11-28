import { Activity, CircleAlert, FileText, Timer } from "lucide-react";

export type RunActivityItem = {
  id: string;
  label: string;
  detail?: string;
  state?: string;
  meta?: string;
  receipt?: () => void;
  logo?: string;
};

export function RunActivity({ rows, label }: { rows: RunActivityItem[]; label: string }) {
  return <ol className="space-y-1" aria-label={label}>{rows.map(row => {
    const issue = row.state === "failed" || row.state === "timed_out" || row.state === "cancelled";
    const waiting = row.state === "queued" || row.state === "awaiting_confirmation" || row.state === "running";
    const Icon = issue ? CircleAlert : waiting ? Timer : row.receipt ? FileText : Activity;
    return <li key={row.id} className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 border-b border-line/60 py-2 last:border-0" data-testid="tool-timeline-row" data-status={row.state}>
      {row.logo ? <img src={row.logo} alt="" className="mt-1 size-5 rounded-sm" /> : <Icon size={17} aria-hidden="true" className={issue ? "mt-1 text-danger" : "mt-1 text-accent"} />}
      <div className="min-w-0 break-words">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="text-sm font-medium">{row.label}</span><span className="text-xs text-muted">{[row.state?.replaceAll("_", " "), row.meta].filter(Boolean).join(" · ")}</span></div>
        {row.detail && <details className="text-sm text-muted"><summary className="min-h-8 cursor-pointer py-1">Details</summary><p className="whitespace-pre-wrap break-words">{row.detail}</p></details>}
        {row.receipt && <button type="button" className="min-h-11 text-xs text-accent underline" onClick={row.receipt}>View receipt</button>}
      </div>
    </li>;
  })}</ol>;
}
