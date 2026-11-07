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
import { LOGIC_ROUTES, activePickerLabel, logicMenuState, type LogicRouteId, type LogicRoutePublic } from "@/lib/mind/logic-routes";

export type ModelTierChipProps = {
  tier: ModelTier;
  onChoose: (tier: ModelTier) => void;
  /** After a completed turn, Auto shows Auto→resolved and optionally the model id. */
  lastResolved?: ConcreteModelTier | null;
  lastModel?: string | null;
  /** Why Auto (or the owner) picked this model — shown in title/aria. */
  tierReason?: string | null;
  className?: string;
  logicRoute?: LogicRouteId | null;
  logicRoutes?: LogicRoutePublic[];
  onChooseLogic?: (route: LogicRouteId) => void;
};

/**
 * Header model chip. Same source of truth as Mode picker: both call onChoose(tier).
 * Not a display preference — selecting a tier changes which model the next send uses.
 */
export function ModelTierChip({
  tier,
  onChoose,
  lastResolved = null,
  lastModel = null,
  tierReason = null,
  className = "",
  logicRoute = null,
  logicRoutes = [],
  onChooseLogic,
}: ModelTierChipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const remembered = typeof window === "undefined" ? null : readTierOutcome();
  const effectiveResolved = lastResolved ?? remembered?.resolved ?? null;
  const effectiveModel = lastModel ?? remembered?.model ?? null;
  const tierLabel = chipLabelForTier({ selected: tier, lastResolved: effectiveResolved, lastModel: effectiveModel });
  const label = activePickerLabel({ logicRoute, tierLabel, routes: logicRoutes });
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
        <div id={menuId} className="absolute right-0 z-40 mt-2 w-80 rounded-panel border border-line bg-surface p-2 shadow-lg" role="menu">
          <p className="px-2 pb-2 text-[10px] font-semibold tracking-[0.16em] text-muted">MODEL</p>
          {MODEL_TIERS.map((item) => (
            <button
              key={item}
              type="button"
              role="menuitemradio"
              aria-checked={logicRoute == null && tier === item}
              className={`flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm ${logicRoute == null && tier === item ? "bg-accent text-accent-ink" : "text-muted hover:bg-surface-2"}`}
              onClick={() => {
                onChoose(selectModelTier(item));
                setOpen(false);
              }}
            >
              {item}
            </button>
          ))}
          <p className="mt-2 px-2 text-[10px] font-semibold tracking-[0.16em] text-muted">ASTRA / SOL / LUNA</p>
          {LOGIC_ROUTES.map((id) => {
            const view = logicRoutes.find((item) => item.id === id);
            const menu = logicMenuState(view, id);
            const selected = logicRoute === id;
            return (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                aria-disabled={!menu.selectable}
                disabled={!menu.selectable}
                data-testid={`logic-route-${id}`}
                data-state={view?.state ?? "unknown"}
                title={menu.detail}
                className={`flex min-h-11 w-full flex-col items-start rounded-xl px-3 py-2 text-left text-sm ${selected ? "bg-accent text-accent-ink" : "text-muted"} ${menu.selectable ? "hover:bg-surface-2" : "cursor-not-allowed opacity-70"}`}
                onClick={() => {
                  if (!menu.selectable) return;
                  onChooseLogic?.(id);
                  setOpen(false);
                }}
              >
                <span>{menu.label}{view ? ` · ${view.state}` : ""}</span>
                <span className="text-[11px] opacity-80">{menu.detail}</span>
              </button>
            );
          })}
          <p className="mt-2 border-t border-line/60 px-2 pt-2 text-[11px] text-muted">
            Astra, Sol, and Luna use provider.status. A needs-config or blocked route cannot be selected. The reply shows the provider and model that actually answered.
          </p>
        </div>
      )}
    </div>
  );
}
