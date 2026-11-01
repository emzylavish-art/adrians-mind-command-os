import type { FlyEvent, FlyState } from "@/lib/mind/dashboard/flyover-fsm";
import type { CityLayout } from "@/lib/mind/dashboard/city-layout";
import type { AgentStat, ProjectBuilding, ProjectsDashboard } from "@/lib/mind/dashboard/projects";

export function sendFly(ev: FlyEvent) {
  document.dispatchEvent(new CustomEvent<FlyEvent>("dash3d-fly", { detail: ev }));
}

const LEVEL_LABEL: Record<FlyState["level"], string> = {
  universe: "Above the clouds · universe",
  city: "Projects city",
  interior: "Inside building",
};

/** Level breadcrumb + accessible doors (keyboard alternative to clicking a door in WebGL). */
export function FlyoverHud({ fly, layout }: { fly: FlyState; layout: CityLayout }) {
  return (
    <nav className="dash3d-flyhud dash3d-glass" aria-label="Flyover camera" data-fly-level={fly.level}>
      <h2>Flyover</h2>
      <p className="dash3d-title">{LEVEL_LABEL[fly.level]}</p>
      <div className="dash3d-flyhud-row">
        {fly.level === "universe" ? (
          <button type="button" className="dash3d-pill" data-testid="fly-dive" onClick={() => sendFly({ type: "DIVE" })}>
            ↓ Dive to city
          </button>
        ) : (
          <>
            <button type="button" className="dash3d-pill" data-testid="fly-out" onClick={() => sendFly({ type: "ZOOM_OUT" })}>
              ↑ Zoom out
            </button>
            <button type="button" className="dash3d-pill" data-testid="fly-sky" onClick={() => sendFly({ type: "SKY" })}>
              ☁ Above the clouds
            </button>
          </>
        )}
      </div>
      {fly.level !== "universe" ? (
        layout.available ? (
          <ul className="dash3d-list dash3d-flyhud-doors" aria-label="Building doors">
            {layout.buildings.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className={`dash3d-pill ${fly.buildingId === b.id ? "is-active" : ""}`}
                  data-building={b.id}
                  onClick={() => sendFly({ type: "ENTER", buildingId: b.id, part: "door" })}
                >
                  <span className={`dash3d-dot ${b.health}`} />
                  {b.name}
                  <span className="dash3d-muted">
                    {" "}
                    {b.progressKnown ? `${Math.round(b.progress * 100)}%` : "progress unknown"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dash3d-muted">City unavailable — {layout.reason ?? "no project data"}</p>
        )
      ) : (
        <p className="dash3d-muted" style={{ fontSize: "0.72rem" }}>
          Scroll in past the stars or press Dive. Click a door or window to step inside.
        </p>
      )}
    </nav>
  );
}

function fmtTime(at: string | null): string {
  if (!at) return "time not recorded";
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return "time not recorded";
  // WAT display (Africa/Lagos)
  return `${new Date(ms).toLocaleString("en-GB", { timeZone: "Africa/Lagos", hour12: false })} WAT`;
}

/** Interior detail view for a project/bot building. React escapes all text (no innerHTML). */
export function BuildingInteriorPanel({
  fly,
  projects,
  onClose,
}: {
  fly: FlyState;
  projects: ProjectsDashboard | null | undefined;
  onClose: () => void;
}) {
  const open = fly.level === "interior" && Boolean(fly.buildingId);
  const p: ProjectBuilding | undefined = projects?.projects?.find((x) => x.id === fly.buildingId);
  const agents: AgentStat[] = p ? (projects?.agents ?? []).filter((a) => p.bots.includes(a.name)) : [];
  return (
    <aside className={`dash3d-side dash3d-interior ${open ? "is-open" : ""}`} aria-hidden={!open} data-testid="interior-panel">
      <div className="dash3d-glass">
        <button type="button" className="dash3d-side-close" onClick={onClose} aria-label="Leave building">
          ×
        </button>
        {!p ? (
          <>
            <h2>Interior</h2>
            <p className="dash3d-muted">Building data unavailable (it may have left the city on the last refresh).</p>
          </>
        ) : (
          <>
            <h2>{p.kind === "project" ? "Project building" : "Bot building"}{fly.part === "window" && fly.floor != null ? ` · floor ${fly.floor}` : ""}</h2>
            <p className="dash3d-title">{p.name}</p>
            <p>
              <span className={`dash3d-dot ${p.health}`} /> <strong>{p.health}</strong>
              <span className="dash3d-muted"> · last activity {fmtTime(p.lastActivityAt)}</span>
            </p>
            <div className="dash3d-progress" role="img" aria-label={p.progressKnown ? `progress ${Math.round(p.progress * 100)}%` : "progress unknown"}>
              {p.progressKnown ? (
                <div className={`dash3d-progress-fill ${p.health}`} style={{ width: `${Math.round(p.progress * 100)}%` }} />
              ) : null}
            </div>
            <p className="dash3d-muted" style={{ fontSize: "0.75rem" }}>
              {p.progressKnown ? `${Math.round(p.progress * 100)}% · ` : "Progress unknown (no real task ratio) · "}
              {p.openTasks} open · {p.doneTasks} done
            </p>
            {p.emptyReason ? <p className="dash3d-muted">{p.emptyReason}</p> : null}

            <h3>Tasks</h3>
            <ul className="dash3d-list">
              {p.tasks.length ? (
                p.tasks.slice(0, 12).map((t) => (
                  <li key={t.id}>
                    <span className={`dash3d-dot ${t.status === "done" ? "healthy" : "stalled"}`} /> {t.title}
                    <span className="dash3d-muted dash3d-mono"> · {t.source.split("/").pop()}</span>
                  </li>
                ))
              ) : (
                <li className="dash3d-muted">No tasks recorded.</li>
              )}
            </ul>

            <h3>Recent runs</h3>
            <ul className="dash3d-list dash3d-mono">
              {p.recentRuns.length ? (
                p.recentRuns.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    {r.label.slice(0, 90)}
                    <span className="dash3d-muted"> · {fmtTime(r.at)} · {r.ok == null ? "result not recorded" : r.ok ? "ok" : "failed"}</span>
                  </li>
                ))
              ) : (
                <li className="dash3d-muted">No runs recorded.</li>
              )}
            </ul>

            <h3>Contributing bots</h3>
            <ul className="dash3d-list">
              {agents.length ? (
                agents.map((a) => (
                  <li key={a.botId}>
                    <span className={`dash3d-dot ${a.health}`} /> {a.name}
                    <span className="dash3d-muted dash3d-mono">
                      {" "}· runs {a.runs} · ok {a.success} · fail {a.failure} · {a.branch ?? "no branch"}
                    </span>
                  </li>
                ))
              ) : p.bots.length ? (
                p.bots.map((b) => <li key={b}>{b}</li>)
              ) : (
                <li className="dash3d-muted">No contributing bots recorded.</li>
              )}
            </ul>
            {p.notes ? <p className="dash3d-muted dash3d-mono" style={{ fontSize: "0.7rem", marginTop: "0.6rem" }}>{p.notes}</p> : null}
          </>
        )}
      </div>
    </aside>
  );
}
