/** Composer effort/mode picker — maps 1:1 onto MODEL_TIERS for the next send. */

import { isModelTier, type ModelTier } from "./model-tiers.ts";

export type ComposerModeId = "auto" | "fast" | "expert" | "heavy" | "build" | "orchestrator";

export type ComposerMode = {
  id: ComposerModeId;
  label: string;
  detail: string;
  /** When false, selecting shows a notice; send still uses the mapped modelTier. */
  wired: boolean;
  notice?: string;
};

export const COMPOSER_MODES: ComposerMode[] = [
  { id: "auto", label: "Auto", detail: "Routes Fast, Expert, Heavy, or Build from the prompt.", wired: true },
  { id: "fast", label: "Fast", detail: "Uses the Fast tier model (MIND_MODEL_FAST).", wired: true },
  { id: "expert", label: "Expert", detail: "Uses the Expert tier model (MIND_MODEL_EXPERT).", wired: true },
  { id: "heavy", label: "Heavy", detail: "Uses the Heavy tier model (MIND_MODEL_HEAVY).", wired: true },
  {
    id: "build",
    label: "Build",
    detail: "Uses the Build tier model and opens the Build surface.",
    wired: true,
  },
  {
    id: "orchestrator",
    label: "Orchestrator",
    detail: "Uses the Orchestrator tier model (MIND_MODEL_ORCHESTRATOR).",
    wired: true,
    notice: "Multi-agent fan-out is not available yet. Send still uses the Orchestrator model on Direct.",
  },
];

export type SendPath = "direct" | "orchestrator-notice";

export function composerModeToModelTier(mode: ComposerModeId): ModelTier {
  switch (mode) {
    case "auto":
      return "Auto";
    case "fast":
      return "Fast";
    case "expert":
      return "Expert";
    case "heavy":
      return "Heavy";
    case "build":
      return "Build";
    case "orchestrator":
      return "Orchestrator";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function modelTierToComposerMode(tier: ModelTier): ComposerModeId {
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
    case "Orchestrator":
      return "orchestrator";
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

export function resolveSendPath(mode: ComposerModeId): { path: SendPath; badge: "Direct" | "Orchestrator"; notice: string | null } {
  const found = COMPOSER_MODES.find((item) => item.id === mode) ?? COMPOSER_MODES[0];
  if (found.id === "orchestrator") {
    return { path: "orchestrator-notice", badge: "Orchestrator", notice: found.notice ?? null };
  }
  return { path: "direct", badge: "Direct", notice: null };
}

export function modeLabel(mode: ComposerModeId): string {
  return COMPOSER_MODES.find((item) => item.id === mode)?.label ?? "Auto";
}

export const COMPOSER_EFFORT_KEY = "amcos.composer.effort.v1";

export function loadComposerEffort(storage: Pick<Storage, "getItem"> | null | undefined): ComposerModeId {
  try {
    const raw = storage?.getItem(COMPOSER_EFFORT_KEY);
    if (raw && COMPOSER_MODES.some((mode) => mode.id === raw)) return raw as ComposerModeId;
  } catch {
    /* private mode */
  }
  return "auto";
}

export function saveComposerEffort(storage: Pick<Storage, "setItem"> | null | undefined, mode: ComposerModeId): void {
  try {
    storage?.setItem(COMPOSER_EFFORT_KEY, mode);
  } catch {
    /* private mode may refuse */
  }
}

/** True only for a real composer effort id (own key, not a prototype name). */
export function isComposerModeId(value: unknown): value is ComposerModeId {
  return typeof value === "string" && COMPOSER_MODES.some((mode) => mode.id === value);
}

export type TierSelection = { tier: ModelTier; mode: ComposerModeId };

/**
 * Validated Mode/Effort pair for a Mode-picker, header chip, or intent-predictor selection.
 * Unknown or hostile input is refused (null) so Mode and Effort can never desync or persist garbage.
 */
export function tierSelection(input: unknown): TierSelection | null {
  if (!isModelTier(input)) return null;
  return { tier: input, mode: modelTierToComposerMode(input) };
}

/** Validated Mode/Effort pair for an Effort-row selection. */
export function effortSelection(input: unknown): TierSelection | null {
  if (!isComposerModeId(input)) return null;
  return { tier: composerModeToModelTier(input), mode: input };
}

/** localStorage key for the chat's Mode (tier). Effort lives at COMPOSER_EFFORT_KEY. */
export const MODEL_TIER_KEY = "amcos.modelTier.v1";

export type SelectionEffects = { notice: string | null; openBuild: boolean };

/**
 * Side effects of a Mode/Effort choice. Shared by the Mode picker, header chip, composer model
 * chip, intent chip, and Effort row so picking Build (or Orchestrator) behaves the same everywhere.
 */
export function selectionEffects(picked: TierSelection): SelectionEffects {
  return { notice: resolveSendPath(picked.mode).notice, openBuild: picked.mode === "build" };
}

/** Reconciled Mode/Effort pair from storage: tier key wins, else effort key, else Auto. Never throws. */
export function readStoredSelection(storage: Pick<Storage, "getItem"> | null | undefined): TierSelection {
  let tierRaw: string | null = null;
  try {
    tierRaw = storage?.getItem(MODEL_TIER_KEY) ?? null;
  } catch {
    /* private mode */
  }
  return tierSelection(tierRaw) ?? effortSelection(loadComposerEffort(storage)) ?? { tier: "Auto", mode: "auto" };
}

/**
 * Pair to adopt when another tab changes storage. null = ignore (unrelated key or hostile value).
 * key === null (storage.clear()) or a removed key re-reads a reconciled pair.
 */
export function crossTabSelection(
  key: string | null,
  newValue: string | null,
  storage: Pick<Storage, "getItem"> | null | undefined,
): TierSelection | null {
  if (key === null) return readStoredSelection(storage);
  if (key !== MODEL_TIER_KEY && key !== COMPOSER_EFFORT_KEY) return null;
  if (newValue === null) return readStoredSelection(storage);
  return key === MODEL_TIER_KEY ? tierSelection(newValue) : effortSelection(newValue);
}
