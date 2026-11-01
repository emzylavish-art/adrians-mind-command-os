import type { IntentAction, RankedIntent } from "./types.ts";

export type IntentRunHandlers = {
  setView?: (view: string) => void;
  navigate?: (href: string) => void;
  setModelTier?: (tier: string) => void;
  openModelPicker?: () => void;
  startVoice?: () => void;
  openPalette?: () => void;
  searchMemory?: () => void;
};

export function runPredictedIntent(
  intent: Pick<RankedIntent, "action"> | { action: IntentAction },
  handlers: IntentRunHandlers,
): boolean {
  const action = intent.action;
  switch (action.type) {
    case "view":
      handlers.setView?.(action.view);
      return Boolean(handlers.setView);
    case "route":
      if (handlers.navigate) {
        handlers.navigate(action.href);
        return true;
      }
      if (typeof window !== "undefined") {
        window.location.assign(action.href);
        return true;
      }
      return false;
    case "model":
      handlers.setModelTier?.(action.tier);
      return Boolean(handlers.setModelTier);
    case "open-model-picker":
      handlers.openModelPicker?.();
      return Boolean(handlers.openModelPicker);
    case "start-voice":
      handlers.startVoice?.();
      return Boolean(handlers.startVoice);
    case "open-palette":
      handlers.openPalette?.();
      return Boolean(handlers.openPalette);
    case "search-memory":
      handlers.searchMemory?.();
      return Boolean(handlers.searchMemory);
    default:
      return false;
  }
}
