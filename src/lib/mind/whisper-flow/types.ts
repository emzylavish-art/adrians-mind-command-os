/** Whisper Flow dictation types — MediaRecorder + server STT path. */

export type WhisperFlowPhase =
  | "idle"
  | "listening"
  | "paused"
  | "transcribing"
  | "error";

export type WhisperFlowState = {
  phase: WhisperFlowPhase;
  status: string | null;
  error: string | null;
  /** Accumulated final transcript inserted this session. */
  insertedText: string;
  /** Pending interim / last chunk text for UI. */
  lastChunkText: string;
  retryable: boolean;
  level: number;
};

export type WhisperFlowAction =
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop_begin" }
  | { type: "chunk_transcribing" }
  | { type: "chunk_ok"; text: string }
  | { type: "chunk_empty" }
  | { type: "error"; message: string; retryable?: boolean }
  | { type: "retry" }
  | { type: "clear_error" }
  | { type: "level"; level: number }
  | { type: "reset" };

export const WHISPER_FLOW_CHUNK_MS = 3000;
export const WHISPER_FLOW_MAX_RETRIES = 3;
