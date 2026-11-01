import type { SkyFeed, FeedKind } from "@/lib/mind/dashboard/sky-feed";
import { NO_SOURCE } from "@/lib/mind/dashboard/sky-feed";

const KIND_LABEL: Record<FeedKind, string> = {
  conductor: "Conductor",
  gap: "Gap",
  lock: "Lock",
  landing: "Landing",
  commit: "Commit",
  merge_gate: "Merge Gate",
  notion_stop: "Notion",
};

type Props = {
  feed: SkyFeed;
  onFocusBot?: (botId: string) => void;
};

export function FeedPanel({ feed, onFocusBot }: Props) {
  const sourceLines = (Object.keys(feed.sources) as FeedKind[]).map((k) => ({
    k,
    src: feed.sources[k],
  }));

  return (
    <aside className="dash3d-feed-panel dash3d-glass" data-testid="feed-panel" aria-label="Sky feed">
      <div className="dash3d-feed-head">
        <h2>Feed</h2>
        <p className="dash3d-muted" style={{ fontSize: "0.65rem" }}>
          {feed.list.length} events
          {feed.droppedFlood || feed.droppedDupes || feed.droppedStale
            ? ` · filtered ${feed.droppedFlood + feed.droppedDupes + feed.droppedStale}`
            : ""}
        </p>
      </div>
      {feed.list.length === 0 ? (
        <p className="dash3d-muted" data-testid="feed-empty" style={{ fontSize: "0.75rem" }}>
          no source yet
        </p>
      ) : (
        <ul className="dash3d-feed-list">
          {feed.list.map((ev) => (
            <li key={ev.id}>
              <button
                type="button"
                className="dash3d-feed-row"
                data-kind={ev.kind}
                data-testid="feed-row"
                title={ev.text}
                disabled={!ev.botId}
                onClick={() => {
                  if (ev.botId) {
                    onFocusBot?.(ev.botId);
                    document.dispatchEvent(
                      new CustomEvent("dash3d-focus-bot", { detail: { botId: ev.botId } }),
                    );
                  }
                }}
              >
                <span className="dash3d-feed-glyph-mark" aria-hidden>
                  {ev.glyph}
                </span>
                <span className="dash3d-feed-row-body">
                  <span className="dash3d-feed-kind">{KIND_LABEL[ev.kind]}</span>
                  <span className="dash3d-feed-text">{ev.text}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <details className="dash3d-feed-sources">
        <summary>Sources</summary>
        <ul>
          {sourceLines.map(({ k, src }) => (
            <li key={k} data-missing={src === NO_SOURCE ? "1" : "0"}>
              <span className="dash3d-feed-kind">{KIND_LABEL[k]}</span>
              <span className="dash3d-mono">{src === NO_SOURCE ? NO_SOURCE : src.slice(0, 64)}</span>
            </li>
          ))}
        </ul>
      </details>
    </aside>
  );
}
