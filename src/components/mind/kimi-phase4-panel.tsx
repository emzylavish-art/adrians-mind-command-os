import { inventoryInitializeCapabilities, normalizeSessionUpdate, type AdvertisedState } from "@/lib/mind/kimi/acp-phase4";

function methodLabel(state: AdvertisedState): string {
  if (state === "advertised") return "Advertised by runtime";
  if (state === "not_advertised") return "Not advertised";
  return "Not yet audited";
}

function flagLabel(state: "advertised" | "not_advertised"): string {
  return state === "advertised" ? "Available per initialize" : "Not advertised";
}

export function KimiPhase4Panel({ initializeResponse, updates = [] }: { initializeResponse: unknown | null; updates?: readonly unknown[] }) {
  const inventory = inventoryInitializeCapabilities(initializeResponse);
  const events = updates.map(normalizeSessionUpdate).filter((event) => event !== null).slice(-12);
  const receivedInitialize = initializeResponse !== null;

  return (
    <section className="dense-card space-y-3 p-4" aria-labelledby="kimi-phase4-heading" data-testid="kimi-phase4-panel">
      <div>
        <h3 id="kimi-phase4-heading" className="font-semibold">Build runtime</h3>
        <p className="text-xs text-muted" role="status" aria-live="polite">
          {receivedInitialize
            ? `${inventory.agent.name ?? "Build runtime"}${inventory.agent.version ? ` · ${inventory.agent.version}` : ""} · capability data from initialize`
            : "Waiting for a real ACP initialize response. No capabilities are assumed available."}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2" aria-label="Session methods">
        {(["fork", "load"] as const).map((method) => (
          <div key={method} className="dense-row flex items-center justify-between gap-3 text-sm">
            <span>session/{method}</span>
            <span className="text-xs text-muted">{methodLabel(inventory.sessionMethods[method])}</span>
          </div>
        ))}
      </div>

      <div className="space-y-1" aria-label="Runtime capability flags">
        {inventory.flags.length ? inventory.flags.map((flag) => (
          <div key={flag.path} className="dense-row flex items-center justify-between gap-3 text-sm">
            <code className="break-all">{flag.path}</code>
            <span className="shrink-0 text-xs text-muted">{flagLabel(flag.state)}</span>
          </div>
        )) : (
          <p className="text-sm text-muted">{receivedInitialize ? "The runtime reported no boolean capability flags." : "Capability status is unknown until initialize completes."}</p>
        )}
      </div>

      <div className="border-t border-line pt-3">
        <h4 className="text-sm font-semibold">ACP activity</h4>
        {events.length ? (
          <ol className="mt-2 space-y-2" aria-label="Build activity">
            {events.map((event, index) => (
              <li key={`${event.updateType}-${index}`} className="dense-row text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{event.summary}</span>
                  {event.title ? <span className="text-muted">{event.title}</span> : null}
                  {event.status && event.status !== "unknown" ? <span className="text-xs text-muted">{event.status}</span> : null}
                </div>
                {event.kind === "assistant_message" && event.text ? <p className="mt-1 whitespace-pre-wrap break-words text-muted">{event.text}</p> : null}
                {event.kind === "plan_progress" ? <p className="mt-1 text-xs text-muted">{event.completedStepCount ?? 0} of {event.planStepCount ?? 0} steps complete. Plan text is not exposed.</p> : null}
              </li>
            ))}
          </ol>
        ) : <p className="mt-1 text-sm text-muted">No ACP updates received. Raw tool arguments/results and private reasoning are not displayed here.</p>}
      </div>

      <p className="border-t border-line pt-3 text-xs text-muted">
        MCP forwarding is fail-closed: only an explicitly approved, enabled, allowlisted transport may be mapped after the runtime contract is verified. HTTP/OAuth and secret-bearing connectors are not forwarded by default.
      </p>
    </section>
  );
}
