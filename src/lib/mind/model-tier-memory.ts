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
  if (selected !== "Auto" && selected !== "Fast" && selected !== "Expert" && selected !== "Heavy" && selected !== "Build") {
    return null;
  }
  if (resolved !== "Fast" && resolved !== "Expert" && resolved !== "Heavy" && resolved !== "Build") {
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
