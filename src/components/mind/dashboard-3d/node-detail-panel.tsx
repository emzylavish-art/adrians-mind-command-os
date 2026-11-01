import type { BotNode } from "@/lib/mind/dashboard/types";
import type { NotionSnapPage } from "@/lib/mind/dashboard/notion-graph-core";
import {
  NO_SOURCE,
  buildBotDetailView,
  formatWat,
  notionNeighborIds,
  type BotDetailView,
} from "@/lib/mind/dashboard/bot-detail";
import type { DashboardStatus } from "@/lib/mind/dashboard/types";

export type SpendView =
  | { available: false; reason: string }
  | { available: true; summary: string };

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const v = value && value.trim() ? value : NO_SOURCE;
  return (
    <>
      {label}: <span className={v === NO_SOURCE ? "dash3d-muted" : undefined}>{v}</span>
      <br />
    </>
  );
}

function BotDetailBody({ detail, spend, portraitSrc }: { detail: BotDetailView; spend?: SpendView | null; portraitSrc?: string | null }) {
  return (
    <>
      <h2>Star detail</h2>
      {portraitSrc ? (
        <img
          className="dash3d-portrait"
          src={portraitSrc}
          alt=""
          width={72}
          height={72}
          loading="lazy"
        />
      ) : null}
      <p className="dash3d-title">{detail.name}</p>
      <p>
        <span className={`dash3d-dot ${detail.health}`} /> <strong>{detail.health}</strong>
        <span className="dash3d-muted"> — {detail.reason || NO_SOURCE}</span>
      </p>
      <p className="dash3d-mono dash3d-muted" style={{ marginTop: "0.75rem" }}>
        <Field label="lane" value={detail.laneName ? `${detail.laneName}${detail.laneHealth ? ` · ${detail.laneHealth}` : ""}` : null} />
        <Field label="lock" value={detail.lockFile} />
        <Field label="status" value={detail.lockStatus} />
        <Field label="claimed_at" value={detail.claimedAt ? formatWat(detail.claimedAt) : null} />
        <Field label="heartbeat" value={detail.heartbeatAt ? formatWat(detail.heartbeatAt) : null} />
        <Field label="task" value={detail.task} />
        <Field label="branch" value={detail.branch} />
        <Field label="worktree" value={detail.worktree} />
      </p>

      <h3 style={{ marginTop: "1rem" }}>Recent commits (branch)</h3>
      <ul className="dash3d-list">
        {detail.branchCommits.length ? (
          detail.branchCommits.map((c) => (
            <li key={c.sha} className="dash3d-mono">
              {c.sha} · {c.subject || NO_SOURCE}
              <br />
              <span className="dash3d-muted">{formatWat(c.date)}</span>
            </li>
          ))
        ) : (
          <li className="dash3d-muted">{NO_SOURCE}</li>
        )}
      </ul>

      <h3 style={{ marginTop: "1rem" }}>Lock commits</h3>
      <ul className="dash3d-list">
        {detail.lockCommits.length ? (
          detail.lockCommits.map((c) => (
            <li key={c} className="dash3d-mono">{c}</li>
          ))
        ) : (
          <li className="dash3d-muted">{NO_SOURCE}</li>
        )}
      </ul>

      <h3 style={{ marginTop: "1rem" }}>Queue items</h3>
      <ul className="dash3d-list">
        {detail.queueItems.length ? (
          detail.queueItems.map((q) => (
            <li key={q.index}>
              #{q.index} {q.title} · {q.status}
              <span className="dash3d-muted dash3d-mono"> · {q.detail || NO_SOURCE}</span>
            </li>
          ))
        ) : (
          <li className="dash3d-muted">{NO_SOURCE}</li>
        )}
      </ul>

      <h3 style={{ marginTop: "1rem" }}>Notion pages</h3>
      <ul className="dash3d-list">
        {detail.notionPages.length ? (
          detail.notionPages.map((p) => (
            <li key={p.id}>
              <a className="dash3d-pill" href={p.url} target="_blank" rel="noreferrer">
                {p.title || p.id}
              </a>
              <span className="dash3d-muted" style={{ display: "block", fontSize: "0.72rem" }}>
                {(p.excerpt || NO_SOURCE).slice(0, 160)}
              </span>
            </li>
          ))
        ) : (
          <li className="dash3d-muted">{NO_SOURCE}</li>
        )}
      </ul>

      <h3 style={{ marginTop: "1rem" }}>Connections</h3>
      <ul className="dash3d-list">
        {detail.connections.length ? (
          detail.connections.map((c) => (
            <li key={`${c.kind}:${c.id}`}>
              <span className="dash3d-muted dash3d-mono">{c.kind}</span> · {c.name}
            </li>
          ))
        ) : (
          <li className="dash3d-muted">{NO_SOURCE}</li>
        )}
      </ul>

      <h3 style={{ marginTop: "1rem" }}>API spend</h3>
      <p className="dash3d-muted" style={{ fontSize: "0.78rem" }}>
        {spend == null ? NO_SOURCE : spend.available ? spend.summary : spend.reason || NO_SOURCE}
      </p>

      <h3 style={{ marginTop: "1rem" }}>Notes</h3>
      <pre className="dash3d-mono dash3d-muted" style={{ whiteSpace: "pre-wrap", margin: "0.35rem 0 0", fontSize: "0.72rem" }}>
        {detail.notes || NO_SOURCE}
      </pre>
    </>
  );
}

export function NodeDetailPanel({
  bot,
  notionPage,
  open,
  onClose,
  spend,
  status,
  notionNeighbors,
  portraitSrc,
}: {
  bot: BotNode | null;
  notionPage: NotionSnapPage | null;
  open: boolean;
  onClose: () => void;
  spend?: SpendView | null;
  status?: DashboardStatus | null;
  notionNeighbors?: NotionSnapPage[];
  portraitSrc?: string | null;
}) {
  const detail =
    bot && status
      ? buildBotDetailView({
          bot,
          bots: status.bots,
          commits: status.commits,
          constellations: status.constellations,
          constellationEdges: status.constellationEdges,
          notionGraph: status.notionGraph,
          fleetPlan: status.fleetPlan,
        })
      : null;

  return (
    <aside className={`dash3d-side dash3d-node-detail ${open && (bot || notionPage) ? "is-open" : ""}`} aria-hidden={!open} data-testid="node-detail" data-dash3d-node={bot?.id ?? notionPage?.id ?? undefined}>
      <div className="dash3d-glass dash3d-node-card">
        <button type="button" className="dash3d-side-close" onClick={onClose} aria-label="Close details">
          ×
        </button>
        {detail ? <BotDetailBody detail={detail} spend={spend} portraitSrc={portraitSrc} /> : null}
        {!detail && bot ? (
          <p className="dash3d-muted">Detail data {NO_SOURCE}</p>
        ) : null}

        {notionPage ? (
          <>
            <h2 style={{ marginTop: bot ? "1.25rem" : 0 }}>Notion page</h2>
            <p className="dash3d-title">{notionPage.title || NO_SOURCE}</p>
            <p className="dash3d-muted" style={{ fontSize: "0.78rem" }}>
              {notionPage.excerpt || NO_SOURCE}
            </p>
            <p className="dash3d-mono dash3d-muted" style={{ marginTop: "0.5rem" }}>
              <Field label="kind" value={notionPage.kind} />
              <Field label="edited" value={notionPage.lastEdited ? formatWat(notionPage.lastEdited) : null} />
              <Field label="id" value={notionPage.id} />
            </p>
            <h3 style={{ marginTop: "0.75rem" }}>Linked neighbors</h3>
            <ul className="dash3d-list">
              {notionNeighbors && notionNeighbors.length ? (
                notionNeighbors.map((n) => (
                  <li key={n.id}>
                    <a className="dash3d-pill" href={n.url} target="_blank" rel="noreferrer">
                      {n.title || n.id}
                    </a>
                  </li>
                ))
              ) : (
                <li className="dash3d-muted">{NO_SOURCE}</li>
              )}
            </ul>
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

/** Helper for app: resolve neighbor pages from graph + selected id. */
export function resolveNotionNeighbors(
  status: DashboardStatus | null | undefined,
  pageId: string | null | undefined,
): NotionSnapPage[] {
  if (!status || !pageId) return [];
  const ids = notionNeighborIds(status.notionGraph, pageId);
  const byId = new Map(status.notionGraph.pages.map((p) => [p.id, p] as const));
  return ids.map((id) => byId.get(id)).filter((p): p is NotionSnapPage => Boolean(p));
}
