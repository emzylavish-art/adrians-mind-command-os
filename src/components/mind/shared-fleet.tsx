import { canBotRun, capabilitiesFor } from "@/lib/mind/fleet/equal-capabilities";
import { DEPARTMENTS, ORCHESTRATOR, fleetRules } from "@/lib/mind/fleet/departments";

const RULES = fleetRules();
const ACTIONS = capabilitiesFor("eve").join(", ");
const BLOCKED = canBotRun({
  botId: "eve",
  action: "mouse",
  approved: "mouse",
  halted: false,
  actor: "owner",
});

export function SharedFleet() {
  return (
    <section className="shared-fleet relative z-10 mx-4 mb-6 rounded-2xl border border-line p-4 md:mx-6" data-testid="shared-fleet" aria-label="Shared fleet">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-semibold">Shared fleet</h3><p className="mt-1 max-w-3xl text-sm text-muted">{ORCHESTRATOR} routes department definitions. They share {RULES.memoryId} memory; they are not independent accounts or running processes.</p></div>
        <span className="runtime-status runtime-status--not_configured">Definitions only</span>
      </div>
      <div className="fleet-facts mt-3" aria-label="Fleet boundaries">
        <span>Shared memory</span><span>Approval required</span><span>{DEPARTMENTS.length} departments</span><span>Secrets unavailable</span>
      </div>
      <p className="fleet-boundary mt-3 text-sm" data-testid="fleet-blocked">
        <strong>Current boundary:</strong> {BLOCKED.ok ? "Mouse was allowed." : BLOCKED.reason} Windows desktop is not controlled.
      </p>
      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Department definitions</p>
      <ul className="fleet-grid mt-2">
        {DEPARTMENTS.map((name) => (
          <li key={name} className="fleet-department rounded-xl border border-line px-3 py-3 text-sm" data-testid="fleet-bot">
            <span className="font-semibold">{name}</span>
            <span className="mt-1 block text-xs text-muted">{ACTIONS}</span>
            <span className="mt-2 block text-xs text-muted">Definition saved · action approval required</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-3 md:grid-cols-2" data-testid="fleet-split">
        <div className="rounded-panel border border-line px-3 py-2 text-sm">
          <p className="font-semibold">Available when a runtime is connected</p>
          <p className="mt-1 text-muted">Department routing and the listed capabilities can be requested after per-action approval.</p>
        </div>
        <div className="rounded-panel border border-line px-3 py-2 text-sm">
          <p className="font-semibold">Still requires your setup</p>
          <p className="mt-1 text-muted">A paired PC, local model download, Windows signing, and production deployment are not delegated by this directory.</p>
        </div>
      </div>
    </section>
  );
}
