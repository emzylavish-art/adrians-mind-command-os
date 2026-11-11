/** Composer effort/mode picker. Only modes with real behavior are actionable. */

export type ComposerModeId = "auto" | "fast" | "expert" | "heavy" | "build" | "orchestrator";

export type ComposerMode = {
  id: ComposerModeId;
  label: string;
  detail: string;
  /** When false, selecting shows a notice and send stays on Direct. */
  wired: boolean;
  notice?: string;
};

export const COMPOSER_MODES: ComposerMode[] = [
  { id: "auto", label: "Auto", detail: "Uses the existing Auto route. It picks Fast, Expert, Heavy, or Build from the prompt.", wired: true },
  { id: "fast", label: "Fast", detail: "Selects the existing Fast Grok tier.", wired: true },
  { id: "expert", label: "Expert", detail: "Selects the existing Expert Grok tier.", wired: true },
  { id: "heavy", label: "Heavy", detail: "Selects the existing Heavy Grok tier.", wired: true },
  {
    id: "build",
    label: "Build",
    detail: "Opens the Build surface. File edit and terminal stay unavailable until a computer is paired.",
    wired: true,
  },
  {
    id: "orchestrator",
    label: "Orchestrator",
    detail: "Uses the existing Orchestrator route when a computer is paired.",
    wired: false,
    notice: "Text send stays on Direct. Orchestrator runs only when a computer is paired.",
  },
];

export type SendPath = "direct" | "blocked-orchestrator";

export function resolveSendPath(mode: ComposerModeId): { path: SendPath; badge: "Direct" | "Orchestrator"; notice: string | null } {
  const found = COMPOSER_MODES.find((item) => item.id === mode) ?? COMPOSER_MODES[0];
  if (found.id === "orchestrator" && !found.wired) {
    return { path: "blocked-orchestrator", badge: "Direct", notice: found.notice ?? null };
  }
  return { path: "direct", badge: "Direct", notice: null };
}

export type EffortModelTier = "Auto" | "Fast" | "Expert" | "Heavy";

/** Effort values that already have a Grok tier. Build and Orchestrator do not change the chat model. */
export function effortModelTier(mode: ComposerModeId): EffortModelTier | null {
  if (mode === "auto") return "Auto";
  if (mode === "fast") return "Fast";
  if (mode === "expert") return "Expert";
  if (mode === "heavy") return "Heavy";
  return null;
}

export function effortForModelTier(tier: string): ComposerModeId | null {
  if (tier === "Auto") return "auto";
  if (tier === "Fast") return "fast";
  if (tier === "Expert") return "expert";
  if (tier === "Heavy") return "heavy";
  return null;
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
