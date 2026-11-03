import type { PairingCardState } from "@/lib/mind/pairing";

/**
 * Build-page pairing card. Honest: never fakes Connected.
 * Mount from Build view when command-app.tsx is free; until then ServiceBoard
 * Local computer prop + /api/mind/pairing/status drive the same state.
 */
export function PairingCard({
  state,
  onMintCode,
  onEmergencyStop,
  onClearStop,
  mintBusy,
}: {
  state: PairingCardState;
  onMintCode?: () => void;
  onEmergencyStop?: () => void;
  onClearStop?: () => void;
  mintBusy?: boolean;
}) {
  if (!state.paired) {
    return (
      <div className="promo-banner text-sm" data-testid="pairing-card-not-paired">
        <img src="/empty/empty-folder.svg" alt="" className="h-14 w-20" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Local Companion not paired</p>
          <p className="text-muted">{state.detail}</p>
          <p className="mt-1 text-muted">Pair a computer to unlock file edits, tests, and git. Nothing runs until then.</p>
        </div>
        {onMintCode ? (
          <button
            type="button"
            className="min-h-11 rounded-panel border border-line px-3 text-sm"
            disabled={mintBusy}
            onClick={onMintCode}
          >
            Mint pairing code
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="promo-banner text-sm"
      data-testid="pairing-card-connected"
      data-emergency-stopped={state.emergencyStopped ? "true" : "false"}
    >
      <img src="/empty/empty-folder.svg" alt="" className="h-14 w-20" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {state.label}: {state.deviceName}
        </p>
        <p className="text-muted">{state.detail}</p>
        <p className="mt-1 text-xs text-muted">
          File edit: {state.fileEditEnabled ? "enabled" : "disabled"} · Terminal:{" "}
          {state.terminalEnabled ? "enabled" : "disabled"} · Last seen {state.lastSeenAt}
        </p>
      </div>
      {state.emergencyStopped ? (
        onClearStop ? (
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={onClearStop}>
            Clear emergency stop
          </button>
        ) : null
      ) : onEmergencyStop ? (
        <button type="button" className="min-h-11 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink" onClick={onEmergencyStop}>
          Emergency stop
        </button>
      ) : null}
    </div>
  );
}

