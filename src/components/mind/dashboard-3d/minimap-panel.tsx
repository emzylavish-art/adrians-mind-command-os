import { useEffect, useState } from "react";
import type { BotNode } from "@/lib/mind/dashboard/types";
import { botWorldPosition } from "@/lib/mind/dashboard/constellations";
import { projectMinimap } from "@/lib/mind/dashboard/minimap";

export function MinimapPanel({ bots, focusId }: { bots: readonly BotNode[]; focusId?: string | null }) {
  const [look, setLook] = useState<[number, number, number]>([0, 0, 0]);
  useEffect(() => {
    const onCam = (ev: Event) => {
      const d = (ev as CustomEvent<{ lookAt?: [number, number, number] }>).detail;
      if (d?.lookAt && d.lookAt.length === 3) setLook(d.lookAt);
    };
    document.addEventListener("dash3d-camera", onCam);
    return () => document.removeEventListener("dash3d-camera", onCam);
  }, []);
  const mapped = bots.slice(0, 48).map((b) => ({
    id: b.id,
    pos: botWorldPosition(b.id),
    health: b.health,
  }));
  const { points, home } = projectMinimap(mapped, look);
  return (
    <aside className="dash3d-minimap dash3d-glass" data-testid="orientation-minimap" aria-label="Orientation minimap">
      <h2>Compass</h2>
      <div className="dash3d-minimap-map" data-testid="minimap-map">
        {points.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`dash3d-minimap-dot${focusId === p.id ? " is-focus" : ""}`}
            data-health={p.health}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            title={p.id}
            onClick={() =>
              document.dispatchEvent(new CustomEvent("dash3d-focus-bot", { detail: { botId: p.id } }))
            }
          />
        ))}
        <span className="dash3d-minimap-home" style={{ left: `${home.x * 100}%`, top: `${home.y * 100}%` }} />
      </div>
    </aside>
  );
}
