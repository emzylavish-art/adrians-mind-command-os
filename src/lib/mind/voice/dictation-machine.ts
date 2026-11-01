/** Pure dictation UI state machine — no DOM, no MediaRecorder. */

export type DictationPhase = "idle" | "recording" | "transcribing";

export type DictationMachineState = {
  phase: DictationPhase;
  draft: string;
  status: string | null;
  peakLevel: number;
};

export type DictationAction =
  | { type: "start" }
  | { type: "toggle" }
  | { type: "level"; level: number }
  | { type: "stop_begin" }
  | { type: "stop_inserted"; text: string }
  | { type: "stop_empty" }
  | { type: "stop_silent" }
  | { type: "stop_error"; message: string }
  | { type: "cancel" }
  | { type: "overlay_open" };

export function createDictationMachine(draft = ""): DictationMachineState {
  return { phase: "idle", draft, status: null, peakLevel: 0 };
}

export function reduceDictation(
  state: DictationMachineState,
  action: DictationAction,
): DictationMachineState {
  switch (action.type) {
    case "start":
      if (state.phase !== "idle") return state;
      return {
        ...state,
        phase: "recording",
        status: "Dictation recording… Stop to insert text into the composer (nothing is sent).",
        peakLevel: 0,
      };
    case "toggle":
      if (state.phase === "idle") return reduceDictation(state, { type: "start" });
      if (state.phase === "recording") return reduceDictation(state, { type: "stop_begin" });
      return state;
    case "level":
      if (state.phase !== "recording") return state;
      return { ...state, peakLevel: Math.max(state.peakLevel, action.level) };
    case "stop_begin":
      if (state.phase !== "recording") return state;
      return { ...state, phase: "transcribing", status: "Transcribing dictation…" };
    case "stop_inserted": {
      const text = action.text.trim();
      if (!text) return reduceDictation(state, { type: "stop_empty" });
      const base = state.draft.trimEnd();
      const nextDraft = !base ? text : `${base} ${text}`;
      return {
        phase: "idle",
        draft: nextDraft,
        status: "Dictation inserted into the composer. Nothing was sent.",
        peakLevel: 0,
      };
    }
    case "stop_empty":
      return {
        phase: "idle",
        draft: state.draft,
        status: "No speech detected. Nothing was inserted.",
        peakLevel: 0,
      };
    case "stop_silent":
      return {
        phase: "idle",
        draft: state.draft,
        status: "No speech detected. Nothing was inserted.",
        peakLevel: 0,
      };
    case "stop_error":
      return {
        phase: "idle",
        draft: state.draft,
        status: action.message,
        peakLevel: 0,
      };
    case "cancel":
      if (state.phase === "idle") return state;
      return {
        phase: "idle",
        draft: state.draft,
        status: "Dictation cancelled. Nothing was inserted.",
        peakLevel: 0,
      };
    case "overlay_open":
      if (state.phase === "idle") return { ...state, status: null };
      return {
        phase: "idle",
        draft: state.draft,
        status: null,
        peakLevel: 0,
      };
    default:
      return state;
  }
}

/** Peak RMS below this after a stop is treated as silence. */
export const DICTATION_SILENCE_PEAK = 0.02;
