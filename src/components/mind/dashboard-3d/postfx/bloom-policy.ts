/**
 * Bloom degradation. Reduced motion and explicit save-data turn the pass off.
 * Narrow screens and low-power devices keep a short pass (low), never a full one.
 */
export type BloomTier = "off" | "low" | "full";

export type BloomTierInput = {
  reducedMotion?: boolean;
  narrow?: boolean;
  saveData?: boolean;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
};

export function bloomTier(input: BloomTierInput = {}): BloomTier {
  if (input.reducedMotion || input.saveData) return "off";
  const cores = input.hardwareConcurrency;
  const mem = input.deviceMemoryGb;
  const lowCores = typeof cores === "number" && Number.isFinite(cores) && cores > 0 && cores <= 4;
  const lowMem = typeof mem === "number" && Number.isFinite(mem) && mem > 0 && mem <= 4;
  if (input.narrow || lowCores || lowMem) return "low";
  return "full";
}

/** Multiplier on tone strength. Off contributes nothing. */
export function bloomStrengthMultiplier(tier: BloomTier): number {
  if (tier === "off") return 0;
  if (tier === "low") return 0.35;
  return 1;
}
