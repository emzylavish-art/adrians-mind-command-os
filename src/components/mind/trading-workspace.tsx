import { useState } from "react";

const snapshot = "https://fleet-paper-desk.operation-beat-magnus.workers.dev/";
const privateDesk = "https://fleet-control-desk.operation-beat-magnus.workers.dev/login";

export default function TradingWorkspace() {
  const [showSnapshot, setShowSnapshot] = useState(false);
  return (
    <section aria-labelledby="trading-desk-title" className="mx-auto grid w-full max-w-5xl gap-4 p-4 sm:p-6">
      <header>
        <h1 id="trading-desk-title" className="text-2xl font-semibold">Paper trading desk</h1>
        <p className="mt-1 text-sm text-muted">View the fleet’s published snapshot here. Sign in at the private desk for current account records and paper controls.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-expanded={showSnapshot} aria-controls="trading-snapshot" className="min-h-11 rounded-panel border border-line px-4" onClick={() => setShowSnapshot(value => !value)}>
          {showSnapshot ? "Close snapshot" : "View published snapshot"}
        </button>
        <a href={privateDesk} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-panel border border-line px-4">Open private desk in new tab</a>
      </div>
      <div id="trading-snapshot" hidden={!showSnapshot}>
        {showSnapshot && <>
          <p className="mb-2 text-sm text-muted">Read-only snapshot from the trading fleet. Figures reflect its publication date. <a className="underline" href={snapshot} target="_blank" rel="noopener noreferrer">Open snapshot in new tab</a></p>
          <iframe title="Published paper trading snapshot" src={snapshot} sandbox="" referrerPolicy="no-referrer" className="h-[65dvh] w-full rounded-panel border border-line" />
        </>}
      </div>
    </section>
  );
}
