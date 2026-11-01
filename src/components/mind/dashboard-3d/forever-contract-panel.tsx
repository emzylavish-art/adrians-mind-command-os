import type { ForeverContractGuard } from "@/lib/mind/dashboard/forever-contract";

type Props = { guard: ForeverContractGuard; scrubNote?: string | null };

export function ForeverContractPanel({ guard, scrubNote }: Props) {
  return (
    <aside
      className="dash3d-glass dash3d-skybar-card dash3d-forever"
      data-testid="forever-contract"
      data-tone={guard.tone}
      aria-label="Forever-contract queue health"
    >
      <h2>Forever contract</h2>
      {scrubNote ? (
        <p className="dash3d-muted" data-testid="forever-scrub-note" style={{ fontSize: "0.65rem" }}>
          {scrubNote}
        </p>
      ) : null}
      <p className="dash3d-title" data-testid="forever-tone">
        <span className="dash3d-forever-dot" aria-hidden />
        {guard.label}
      </p>
      <p className="dash3d-muted" style={{ fontSize: "0.72rem" }}>
        {guard.summary}
        {guard.head ? ` · head #${guard.head.index} ${guard.head.title}` : ""}
      </p>
      {guard.sourceAvailable && guard.queued.length > 0 ? (
        <ol className="dash3d-forever-queue" aria-label="Next queued upgrades">
          {guard.queued.slice(0, 4).map((q) => (
            <li key={q.index} data-testid="forever-queued">
              <span className="dash3d-forever-idx">#{q.index}</span>
              <span>{q.title}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {guard.needsNextCount > 0 ? (
        <ul className="dash3d-forever-idle" aria-label="Lanes needing next task">
          {guard.needsNextTask.slice(0, 6).map((r) => (
            <li key={r.botId} data-testid="forever-needs-next">
              <span className="dash3d-forever-marker">needs next task</span>
              <span>{r.botName}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dash3d-muted" style={{ fontSize: "0.65rem" }}>
          No idle lanes past 30m.
        </p>
      )}
    </aside>
  );
}
