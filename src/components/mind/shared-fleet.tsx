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
    <section className="relative z-10 mx-4 mb-6 rounded-panel border border-line p-4 md:mx-6" style={{ background: "#0c0c0e" }} data-testid="shared-fleet" aria-label="Shared fleet">
      <h3 className="font-semibold">Shared fleet</h3>
      <p className="mt-1 text-sm text-muted">
        One orchestrator, {ORCHESTRATOR}, routes work. These bots use the same {RULES.memoryId} memory. They are not separate brains. They cannot see secrets, and they cannot turn the emergency stop on or off.
      </p>
      <p className="mt-2 text-sm" data-testid="fleet-blocked">
        {BLOCKED.ok ? "Mouse was allowed." : BLOCKED.reason} Windows desktop is not controlled.
      </p>
      <ul className="mt-3 space-y-2">
        {DEPARTMENTS.map((name) => (
          <li key={name} className="rounded-panel border border-line px-3 py-2 text-sm" data-testid="fleet-bot">
            <span className="font-semibold">{name}</span>
            <span className="mt-1 block text-muted">
              Same {RULES.memoryId} memory. Same capabilities: {ACTIONS}. Each runs only after you approve that exact action. Halt blocks every bot. None can approve or press the stop.
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-3 md:grid-cols-2" data-testid="fleet-split">
        <div className="rounded-panel border border-line px-3 py-2 text-sm">
          <p className="font-semibold">These nine can close locally</p>
          <p className="mt-1 text-muted">Shared memory, the four hosted actions after the exact approval, department routing, and a refusal for mouse, keyboard, and browser. That work stays in this preview.</p>
        </div>
        <div className="rounded-panel border border-line px-3 py-2 text-sm">
          <p className="font-semibold">Blocked without your machine</p>
          <p className="mt-1 text-muted">Windows installer, desktop control, HyperFrames, a local model download, and a production deploy stay blocked. No bot can close those from this preview.</p>
        </div>
      </div>
    </section>
  );
}
