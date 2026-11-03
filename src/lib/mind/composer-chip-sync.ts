/** Composer-bar model chip ↔ real ModelTier (same source of truth as the Mode picker and header chip). */

import type { ModelTier } from "./model-tiers.ts";

/** Mirrors ComposerModelId in voice-ui/composer-voice-buttons.tsx (kept local so pure tests need no .tsx). */
export type ComposerChipId = "build" | "heavy" | "expert" | "fast" | "auto";

const CHIP_TO_TIER: ReadonlyMap<string, ModelTier> = new Map<string, ModelTier>([
  ["auto", "Auto"],
  ["fast", "Fast"],
  ["expert", "Expert"],
  ["heavy", "Heavy"],
  ["build", "Build"],
]);

/** Chip option for the current tier. Orchestrator has no chip option → null (caller shows its label, selects nothing). */
export function composerChipModelForTier(tier: ModelTier): ComposerChipId | null {
  switch (tier) {
    case "Auto":
      return "auto";
    case "Fast":
      return "fast";
    case "Expert":
      return "expert";
    case "Heavy":
      return "heavy";
    case "Build":
      return "build";
    default:
      return null;
  }
}

/** Tier for a chip selection; unknown ids are refused (null) rather than coerced to Auto. */
export function modelTierForComposerChip(id: unknown): ModelTier | null {
  if (typeof id !== "string") return null;
  return CHIP_TO_TIER.get(id) ?? null;
}
