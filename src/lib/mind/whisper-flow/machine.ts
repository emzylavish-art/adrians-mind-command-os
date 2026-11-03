/** Pure Whisper Flow UI state machine — no DOM / MediaRecorder. */

import type { WhisperFlowAction, WhisperFlowState } from "./types.ts";

export function createWhisperFlowState(): WhisperFlowState {
  return {
    phase: "idle",
    status: null,
    error: null,
    insertedText: "",
    lastChunkText: "",
    retryable: false,
    level: 0,
  };
}

export function reduceWhisperFlow(
  state: WhisperFlowState,
  action: WhisperFlowAction,
): WhisperFlowState {
  switch (action.type) {
    case "start":
      if (state.phase !== "idle" && state.phase !== "error") return state;
      return {
        ...state,
        phase: "listening",
        status: "Whisper Flow listening… Text inserts into the focused field. Nothing is sent.",
        error: null,
        retryable: false,
        insertedText: "",
        lastChunkText: "",
        level: 0,
      };
    case "pause":
      if (state.phase !== "listening" && state.phase !== "transcribing") return state;
      return {
        ...state,
        phase: "paused",
        status: "Whisper Flow paused. Resume to continue, or Stop to finish.",
        level: 0,
      };
    case "resume":
      if (state.phase !== "paused") return state;
      return {
        ...state,
        phase: "listening",
        status: "Whisper Flow listening… Text inserts into the focused field. Nothing is sent.",
        error: null,
        retryable: false,
      };
    case "stop_begin":
      if (
        state.phase !== "listening" &&
        state.phase !== "paused" &&
        state.phase !== "transcribing"
      ) {
        return state;
      }
      return {
        ...state,
        phase: "transcribing",
        status: "Finishing Whisper Flow transcription…",
      };
    case "chunk_transcribing":
      if (state.phase !== "listening" && state.phase !== "transcribing") return state;
      return {
        ...state,
        phase: state.phase === "listening" ? "transcribing" : state.phase,
        status:
          state.phase === "listening"
            ? "Transcribing dictation chunk…"
            : state.status,
      };
    case "chunk_ok": {
      const text = action.text.trim();
      if (!text) return reduceWhisperFlow(state, { type: "chunk_empty" });
      const nextInserted = state.insertedText
        ? `${state.insertedText} ${text}`
        : text;
      // After a progressive chunk while listening, return to listening.
      const backToListening = state.phase === "transcribing" || state.phase === "listening";
      // If we were finishing (stop_begin left us transcribing and no more listening),
      // callers transition to idle via reset/stop completion.
      return {
        ...state,
        phase: backToListening ? "listening" : state.phase,
        status: "Dictation inserted. Nothing was sent.",
        error: null,
        retryable: false,
        insertedText: nextInserted,
        lastChunkText: text,
      };
    }
    case "chunk_empty":
      return {
        ...state,
        phase: state.phase === "transcribing" ? "listening" : state.phase,
        status: "No speech detected in that chunk. Nothing was inserted.",
        lastChunkText: "",
      };
    case "error":
      return {
        ...state,
        phase: "error",
        status: null,
        error: action.message,
        retryable: action.retryable !== false,
        level: 0,
      };
    case "retry":
      if (state.phase !== "error") return state;
      return {
        ...state,
        phase: "listening",
        status: "Retrying Whisper Flow…",
        error: null,
        retryable: false,
      };
    case "clear_error":
      return {
        ...createWhisperFlowState(),
        insertedText: state.insertedText,
      };
    case "level":
      if (state.phase !== "listening") return state;
      return { ...state, level: action.level };
    case "reset":
      return createWhisperFlowState();
    default:
      return state;
  }
}

/** After final stop transcription settles, go idle with honest status. */
export function finishWhisperFlow(state: WhisperFlowState): WhisperFlowState {
  if (state.phase === "error") return state;
  return {
    ...state,
    phase: "idle",
    status: state.insertedText
      ? "Whisper Flow stopped. Text was inserted. Nothing was sent."
      : "Whisper Flow stopped. Nothing was inserted.",
    level: 0,
    error: null,
    retryable: false,
  };
}
