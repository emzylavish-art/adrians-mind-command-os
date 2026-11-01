import type { BotNode } from "@/lib/mind/dashboard/types";

export function NodeDetailPanel({
  bot,
  open,
  onClose,
}: {
  bot: BotNode | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <aside className={`dash3d-side ${open && bot ? "is-open" : ""}`} aria-hidden={!open || !bot}>
      <div className="dash3d-glass">
        <button type="button" className="dash3d-side-close" onClick={onClose} aria-label="Close details">
          ×
        </button>
        {bot ? (
          <>
            <h2>Lane detail</h2>
            <p className="dash3d-title">{bot.name}</p>
            <p>
              <span className={`dash3d-dot ${bot.health}`} />{" "}
              <strong>{bot.health}</strong>
              <span className="dash3d-muted"> — {bot.reason}</span>
            </p>
            <p className="dash3d-mono dash3d-muted" style={{ marginTop: "0.75rem" }}>
              branch: {bot.branch ?? "—"}
              <br />
              activity: {bot.lastActivityAt ?? "—"}
              <br />
              lock: {bot.lock?.file ?? "none"}
              <br />
              status: {bot.lock?.status ?? "—"}
            </p>
            <h3 style={{ marginTop: "1rem" }}>Commits</h3>
            <ul className="dash3d-list">
              {bot.commits.length ? (
                bot.commits.map((c) => (
                  <li key={c} className="dash3d-mono">{c}</li>
                ))
              ) : (
                <li className="dash3d-muted">No commits listed on lock.</li>
              )}
            </ul>
            <h3 style={{ marginTop: "1rem" }}>Notes</h3>
            <pre
              className="dash3d-mono dash3d-muted"
              style={{ whiteSpace: "pre-wrap", margin: "0.35rem 0 0", fontSize: "0.72rem" }}
            >
              {bot.notes || "—"}
            </pre>
          </>
        ) : null}
      </div>
    </aside>
  );
}
