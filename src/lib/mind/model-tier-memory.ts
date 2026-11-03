import type { ConcreteModelTier, ModelTier } from "./model-tiers.ts";

export type TierOutcome = {
  selected: ModelTier;
  resolved: ConcreteModelTier;
  model: string;
  reason: string;
  at: string;
};

const KEY = "amcos.modelTier.outcome.v1";

/** Remember the last turn's routing outcome for chip aria/tooltip (client-only). */
export function rememberTierOutcome(outcome: TierOutcome, storage: Storage | null = null): void {
  const store = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(outcome));
  } catch {
    /* private mode */
  }
}

/** Drop the remembered outcome so the chip cannot fall back to an older turn's tier. */
export function forgetTierOutcome(storage: Storage | null = null): void {
  const store = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

export function readTierOutcome(storage: Storage | null = null): TierOutcome | null {
  const store = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TierOutcome;
    if (!parsed || typeof parsed.model !== "string" || typeof parsed.reason !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function outcomeFromDoneEvent(event: {
  model: string;
  modelTier?: string;
  resolvedTier?: string;
  tierReason?: string;
}): TierOutcome | null {
  const selected = event.modelTier;
  const resolved = event.resolvedTier;
  if (
    selected !== "Auto" &&
    selected !== "Fast" &&
    selected !== "Expert" &&
    selected !== "Heavy" &&
    selected !== "Build" &&
    selected !== "Orchestrator"
  ) {
    return null;
  }
  if (
    resolved !== "Fast" &&
    resolved !== "Expert" &&
    resolved !== "Heavy" &&
    resolved !== "Build" &&
    resolved !== "Orchestrator"
  ) {
    return null;
  }
  return {
    selected,
    resolved,
    model: event.model,
    reason: event.tierReason?.trim() || (selected === "Auto" ? `Auto resolved to ${resolved}.` : `Owner selected ${selected}.`),
    at: new Date().toISOString(),
  };
}

const SELECTABLE: readonly ModelTier[] = ["Auto", "Fast", "Expert", "Heavy", "Build", "Orchestrator"];
const CONCRETE: readonly ConcreteModelTier[] = ["Fast", "Expert", "Heavy", "Build", "Orchestrator"];

/** Last finished turn as the header chip should describe it (command-app state). */
export type ChipTierRun = { selected: ModelTier; resolved: ConcreteModelTier | null; model: string | null };

/**
 * Build the chip's record of a finished turn. Always replaces the previous run so an
 * Orchestrator turn, or a turn whose done event lacks/forges resolvedTier, cannot leave a
 * stale "Auto→Fast" (or another tier's model id) on the chip.
 */
export function tierRunFromResult(
  result: { model?: unknown; modelTier?: unknown; resolvedTier?: unknown },
  sentTier: ModelTier,
): ChipTierRun {
  const selected = SELECTABLE.find((tier) => tier === result.modelTier) ?? sentTier;
  const resolved = CONCRETE.find((tier) => tier === result.resolvedTier) ?? null;
  const rawModel = typeof result.model === "string" ? result.model.trim() : "";
  const model = rawModel && rawModel.length <= 120 ? rawModel : null;
  return { selected, resolved, model };
}

/** Only describe the last turn on the chip while the same tier is still selected. */
export function chipPropsForSelection(
  run: ChipTierRun | null,
  selected: ModelTier,
): { lastResolved: ConcreteModelTier | null; lastModel: string | null } {
  if (!run || run.selected !== selected) return { lastResolved: null, lastModel: null };
  return { lastResolved: run.resolved, lastModel: run.model };
}
