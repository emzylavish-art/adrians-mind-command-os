import type { MoneyView } from "@/lib/mind/dashboard/spend-core";
import { NO_SPEND_SOURCE } from "@/lib/mind/dashboard/spend-core";

type Props = { money: MoneyView; scrubNote?: string | null };

function fmtUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

export function MoneyPanel({ money, scrubNote }: Props) {
  const empty = !money.available;
  return (
    <div
      className="dash3d-glass dash3d-skybar-card dash3d-money"
      data-testid="money-panel"
      data-available={money.available ? "1" : "0"}
      data-stale={money.stale ? "1" : "0"}
    >
      <h2>Money</h2>
      {scrubNote ? (
        <p className="dash3d-muted" data-testid="money-scrub-note" style={{ fontSize: "0.65rem" }}>
          {scrubNote}
        </p>
      ) : null}
      {empty ? (
        <>
          <p className="dash3d-title" data-testid="money-empty">
            {money.reason || NO_SPEND_SOURCE}
          </p>
          <p className="dash3d-muted" style={{ fontSize: "0.68rem" }}>
            Burn / today stay blank until a real USD ledger appears at audit/dashboard-3d/spend.jsonl (never invents numbers).
          </p>
        </>
      ) : (
        <>
          <p className="dash3d-title" data-testid="money-today">
            Today {fmtUsd(money.todayTotalUsd)}
            {money.stale ? " · stale" : ""}
          </p>
          <p className="dash3d-muted" style={{ fontSize: "0.72rem" }} data-testid="money-burn">
            Burn {fmtUsd(money.burnPerHourUsd)}/hr · {money.eventCount} event
            {money.eventCount === 1 ? "" : "s"}
          </p>
          {money.warnings.length ? (
            <ul className="dash3d-money-warn" data-testid="money-warnings">
              {money.warnings.map((w) => (
                <li key={w.message} data-level={w.level}>
                  {w.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="dash3d-muted" style={{ fontSize: "0.65rem" }}>
              No threshold warnings
            </p>
          )}
          {money.source ? (
            <p className="dash3d-mono dash3d-muted" style={{ fontSize: "0.58rem" }}>
              {money.source.slice(0, 72)}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
