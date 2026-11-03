import type { BotNode, DashboardStatus } from "@/lib/mind/dashboard/types";

function countBy(bots: BotNode[]) {
  const c = { healthy: 0, stalled: 0, blocked: 0, idle: 0 };
  for (const b of bots) c[b.health] += 1;
  return c;
}

export function GlassHud({ data }: { data: DashboardStatus }) {
  const counts = countBy(data.bots);
  return (
    <div className="dash3d-hud" aria-live="polite">
      <div className="dash3d-top">
        <section className="dash3d-glass">
          <h2>Lane health</h2>
          <p className="dash3d-title">Mind Command OS</p>
          <ul className="dash3d-list">
            <li><span className="dash3d-dot healthy" /> {counts.healthy} healthy</li>
            <li><span className="dash3d-dot stalled" /> {counts.stalled} stalled</li>
            <li><span className="dash3d-dot blocked" /> {counts.blocked} blocked</li>
            <li><span className="dash3d-dot idle" /> {counts.idle} idle</li>
          </ul>
        </section>
        <section className="dash3d-glass">
          <h2>Orchestrator</h2>
          <p className="dash3d-title">{data.orchestrator.owner ?? "Unavailable"}</p>
          <p className="dash3d-mono dash3d-muted">
            {data.orchestrator.status ?? "—"} · {data.orchestrator.branch ?? "no branch"}
          </p>
          <p className="dash3d-muted" style={{ marginTop: "0.35rem", fontSize: "0.75rem" }}>
            {data.orchestrator.notes.slice(0, 160) || "No integration.lock notes."}
          </p>
        </section>
        <section className="dash3d-glass">
          <h2>API spend</h2>
          <p className="dash3d-title">
            {data.spend.available ? "Live log" : "Not connected"}
          </p>
          <p className="dash3d-muted" style={{ fontSize: "0.78rem" }}>
            {data.spend.available
              ? `${data.spend.entries.length} source(s) on box`
              : data.spend.reason}
          </p>
        </section>
        <section className="dash3d-glass">
          <h2>Sources</h2>
          <p className="dash3d-title dash3d-mono" style={{ fontSize: "0.85rem" }}>
            {new Date(data.generatedAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })} WAT
          </p>
          <p className="dash3d-muted" style={{ fontSize: "0.75rem" }}>
            locks {data.sources.locksOk ? "live" : "empty"} · git {data.sources.gitOk ? "live" : "error"} ·
            notion {data.notion.available ? "live" : "unavailable"}
          </p>
        </section>
      </div>

      <div className="dash3d-left">
        <section className="dash3d-glass">
          <h2>Recent commits</h2>
          <p className="dash3d-title">Across branches</p>
          <ul className="dash3d-list">
            {data.commits.slice(0, 8).map((c) => (
              <li key={c.sha}>
                <span className="dash3d-mono" style={{ color: "var(--dash3d-accent)" }}>{c.sha}</span>
                <span>
                  {c.subject}
                  <span className="dash3d-muted"> · {c.branch}</span>
                </span>
              </li>
            ))}
            {!data.commits.length && <li className="dash3d-muted">No commits read from repo.</li>}
          </ul>
        </section>
        <section className="dash3d-glass">
          <h2>Conductor nudges</h2>
          <p className="dash3d-title">{data.conductor.source === "unavailable" ? "Unavailable" : "Feed"}</p>
          <ul className="dash3d-list">
            {data.conductor.nudges.slice(0, 6).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
            {!data.conductor.nudges.length && (
              <li className="dash3d-muted">source: {data.conductor.source}</li>
            )}
          </ul>
        </section>
      </div>

      <div aria-hidden style={{ pointerEvents: "none" }} />

      <div className="dash3d-right">
        <section className="dash3d-glass">
          <h2>Gap Dispatcher</h2>
          <p className="dash3d-title">{data.gapDispatcher.source === "unavailable" ? "Unavailable" : "Open gaps"}</p>
          <ul className="dash3d-list">
            {data.gapDispatcher.items.slice(0, 8).map((g, i) => (
              <li key={`${g.feature}-${i}`}>
                <span className="dash3d-pill">{g.rank ?? "—"}</span>
                <span>
                  {g.feature}
                  {g.status ? <span className="dash3d-muted"> · {g.status}</span> : null}
                </span>
              </li>
            ))}
            {!data.gapDispatcher.items.length && (
              <li className="dash3d-muted">source: {data.gapDispatcher.source}</li>
            )}
          </ul>
        </section>
        <section className="dash3d-glass">
          <h2>Notion stop-points</h2>
          <p className="dash3d-title">{data.notion.available ? "Mirror" : "Not connected"}</p>
          <ul className="dash3d-list">
            {data.notion.available
              ? data.notion.stopPoints.slice(0, 6).map((s, i) => (
                  <li key={i}>{s.text.slice(0, 180)}</li>
                ))
              : (
                <li className="dash3d-muted">{data.notion.reason}</li>
              )}
            {data.notion.available && !data.notion.stopPoints.length && (
              <li className="dash3d-muted">Connected, but no stop-point text matched yet.</li>
            )}
          </ul>
        </section>
      </div>

      <div className="dash3d-bottom">
        <section className="dash3d-glass" style={{ maxHeight: "7rem" }}>
          <h2>Bot nodes</h2>
          <ul className="dash3d-list" style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {data.bots.map((b) => (
              <li key={b.id} style={{ minWidth: "9rem" }}>
                <span className={`dash3d-dot ${b.health}`} />
                <span>{b.name.replace(/ Bot$/, "")}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
