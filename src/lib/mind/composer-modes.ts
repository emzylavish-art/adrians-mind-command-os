/** Composer effort/mode picker — maps 1:1 onto MODEL_TIERS for the next send. */

import type { ModelTier } from "./model-tiers.ts";

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
