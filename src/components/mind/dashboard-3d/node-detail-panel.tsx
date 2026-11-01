import type { BotNode, Health } from "@/lib/mind/dashboard/types";
import type { NotionSnapPage } from "@/lib/mind/dashboard/notion-graph-core";

export type SpendView =
  | { available: false; reason: string }
  | { available: true; summary: string };

export function NodeDetailPanel({
  bot,
  notionPage,
  open,
  onClose,
  laneName,
  laneHealth,
  spend,
}: {
  bot: BotNode | null;
  notionPage: NotionSnapPage | null;
  open: boolean;
  onClose: () => void;
  laneName?: string | null;
  laneHealth?: Health | null;
  spend?: SpendView | null;
}) {
  return (
    <aside className={`dash3d-side ${open && (bot || notionPage) ? "is-open" : ""}`} aria-hidden={!open}>
      <div className="dash3d-glass">
        <button type="button" className="dash3d-side-close" onClick={onClose} aria-label="Close details">
          ×
        </button>
        {bot ? (
          <>
            <h2>Star detail</h2>
            <p className="dash3d-title">{bot.name}</p>
            <p>
              <span className={`dash3d-dot ${bot.health}`} /> <strong>{bot.health}</strong>
              <span className="dash3d-muted"> — {bot.reason}</span>
            </p>
            <p className="dash3d-mono dash3d-muted" style={{ marginTop: "0.75rem" }}>
              lane: {laneName ?? "—"}
              {laneHealth ? (
                <>
                  {" "}
                  · <span className={`dash3d-dot ${laneHealth}`} /> {laneHealth}
                </>
              ) : null}
              <br />
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
              {bot.commits.length ? bot.commits.map((c) => (
                <li key={c} className="dash3d-mono">{c}</li>
              )) : <li className="dash3d-muted">No commits listed on lock.</li>}
            </ul>
            <h3 style={{ marginTop: "1rem" }}>API spend</h3>
            <p className="dash3d-muted" style={{ fontSize: "0.78rem" }}>
              {spend == null
                ? "No source."
                : spend.available
                  ? spend.summary
                  : spend.reason || "No source."}
            </p>
            <h3 style={{ marginTop: "1rem" }}>Notes</h3>
            <pre className="dash3d-mono dash3d-muted" style={{ whiteSpace: "pre-wrap", margin: "0.35rem 0 0", fontSize: "0.72rem" }}>
              {bot.notes || "—"}
            </pre>
          </>
        ) : null}

        {notionPage ? (
          <>
            <h2 style={{ marginTop: bot ? "1.25rem" : 0 }}>Notion page</h2>
            <p className="dash3d-title">{notionPage.title}</p>
            <p className="dash3d-muted" style={{ fontSize: "0.78rem" }}>{notionPage.excerpt || "No excerpt."}</p>
            <p className="dash3d-mono dash3d-muted" style={{ marginTop: "0.5rem" }}>
              kind: {notionPage.kind}
              <br />
              edited: {notionPage.lastEdited ?? "—"}
            </p>
            <p className="dash3d-muted" style={{ marginTop: "0.75rem", fontSize: "0.75rem" }}>
              Notion.so blocks iframe embedding — open the page in Notion instead.
            </p>
            <a
              className="dash3d-pill"
              href={notionPage.url}
              target="_blank"
              rel="noreferrer"
              style={{ marginTop: "0.5rem", display: "inline-flex" }}
            >
              Open in Notion
            </a>
          </>
        ) : null}
      </div>
    </aside>
  );
}
