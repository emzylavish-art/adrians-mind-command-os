import type { NotionMirrorView } from "@/lib/mind/dashboard/notion-mirror";
import { NO_MIRROR_SOURCE } from "@/lib/mind/dashboard/notion-mirror";
import { extractIsoPrefix, formatRelativeWhen } from "@/lib/mind/dashboard/format-when";

type Props = {
  mirror: NotionMirrorView;
  onOpenPage?: (pageId: string) => void;
};


function MirrorTitle({ title }: { title: string | null | undefined }) {
  const raw = title || NO_MIRROR_SOURCE;
  const { iso, rest } = extractIsoPrefix(raw);
  if (!iso) {
    return (
      <span className="dash3d-muted dash3d-mirror-title" title={raw}>
        {raw}
      </span>
    );
  }
  const when = formatRelativeWhen(iso);
  const label = rest ? `${when.label} — ${rest}` : when.label;
  return (
    <span className="dash3d-muted dash3d-mirror-title" title={when.title}>
      {label}
    </span>
  );
}

export function NotionMirrorPanel({ mirror, onOpenPage }: Props) {
  return (
    <aside className="dash3d-glass dash3d-mirror-panel" data-testid="notion-mirror" aria-label="Notion mirror">
      <div className="dash3d-feed-head">
        <h2>Notion mirror</h2>
        <p className="dash3d-muted" style={{ fontSize: "0.62rem" }}>
          {mirror.available
            ? `${mirror.mappedCount} mapped · ${mirror.staleCount} stale · ${mirror.mode}`
            : mirror.reason || NO_MIRROR_SOURCE}
        </p>
      </div>
      {!mirror.available ? (
        <p className="dash3d-muted" data-testid="mirror-empty">
          {mirror.reason || NO_MIRROR_SOURCE}
        </p>
      ) : (
        <ul className="dash3d-mirror-list">
          {mirror.rows.map((r) => (
            <li key={r.botId} data-stale={r.stale ? "1" : "0"} data-testid="mirror-row">
              <button
                type="button"
                className="dash3d-mirror-row"
                disabled={!r.pageId}
                onClick={() => r.pageId && onOpenPage?.(r.pageId)}
              >
                <span className="dash3d-mirror-bot">{r.botName}</span>
                <span className={`dash3d-mirror-fresh${r.stale ? " is-stale" : ""}`}>
                  {r.freshLabel}
                </span>
                <MirrorTitle title={r.title} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
