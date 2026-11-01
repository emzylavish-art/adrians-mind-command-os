import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  MODEL_TIERS,
  chipLabelForTier,
  selectModelTier,
  type ConcreteModelTier,
  type ModelTier,
} from "@/lib/mind/model-tiers";
import { readTierOutcome } from "@/lib/mind/model-tier-memory";

export type ModelTierChipProps = {
  tier: ModelTier;
  onChoose: (tier: ModelTier) => void;
  /** After a completed turn, Auto shows Auto→resolved and optionally the model id. */
  lastResolved?: ConcreteModelTier | null;
  lastModel?: string | null;
  /** Why Auto (or the owner) picked this model — shown in title/aria. */
  tierReason?: string | null;
  className?: string;
};

/**
 * Header model chip. Same source of truth as Mode picker: both call onChoose(tier).
 * Not a display preference — selecting a tier changes which model the next send uses.
 */
export function ModelTierChip({ tier, onChoose, lastResolved = null, lastModel = null, tierReason = null, className = "" }: ModelTierChipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const remembered = typeof window === "undefined" ? null : readTierOutcome();
  const effectiveResolved = lastResolved ?? remembered?.resolved ?? null;
  const effectiveModel = lastModel ?? remembered?.model ?? null;
  const label = chipLabelForTier({ selected: tier, lastResolved: effectiveResolved, lastModel: effectiveModel });
  const reasonText =
    (tierReason && tierReason.trim()) ||
    (remembered?.reason && remembered.reason.trim()) ||
    (tier === "Auto"
      ? "Auto picks Fast, Expert, Heavy, or Build from the prompt. After a turn, the chip shows which model answered."
      : `Mode ${tier} selects a fixed Grok model for the next send.`);


  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`.trim()}>
      <button
        type="button"
        className="model-chip inline-flex h-11 items-center gap-2 rounded-panel border border-line bg-surface px-3 text-sm font-medium"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Model mode ${label}. ${reasonText}`}
        title={reasonText}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="max-w-[14rem] truncate">{label}</span>
        <ChevronDown className="size-3.5 opacity-70" />
      </button>
      {open && (
        <div id={menuId} className="absolute right-0 z-40 mt-2 w-56 rounded-panel border border-line bg-surface p-2 shadow-lg" role="menu">
          <p className="px-2 pb-2 text-[10px] font-semibold tracking-[0.16em] text-muted">MODEL</p>
          {MODEL_TIERS.map((item) => (
            <button
              key={item}
              type="button"
              role="menuitemradio"
              aria-checked={tier === item}
              className={`flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm ${tier === item ? "bg-accent text-accent-ink" : "text-muted hover:bg-surface-2"}`}
              onClick={() => {
                onChoose(selectModelTier(item));
                setOpen(false);
              }}
            >
              {item}
            </button>
          ))}
          <p className="mt-2 border-t border-line/60 px-2 pt-2 text-[11px] text-muted">
            Changes which Grok model runs. Auto routes from the prompt; after a turn the chip shows the resolved model.
          </p>
        </div>
      )}
    </div>
  );
}
