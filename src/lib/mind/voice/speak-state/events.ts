/**
 * Speak-state event contract v0.
 *
 * Every event carries session_id and a monotonic ts_ms.
 * Speak state publishes mic, VAD, barge-in, and session events.
 * The voice pipeline publishes TTS/STT. pipeline.mode is reported by speak
 * state as the path that is actually wired (xai_realtime today) and may be
 * overwritten when a future pipeline sends pipecat or whisper_loop.
 */

export type MicPermissionState = "granted" | "denied" | "prompt";

export type BargeInSource = "vad" | "manual" | "esc";

/** pipecat and whisper_loop are reserved. Nothing in this repo runs them yet. */
export type PipelineMode = "pipecat" | "whisper_loop" | "xai_realtime";

export const CURRENT_PIPELINE_MODE: PipelineMode = "xai_realtime";

export type SessionReason =
  | "speak_button"
  | "user"
  | "reload"
  | "reconnect"
  | "permission_revoked"
  | "device_change"
  | "error"
  | "esc";

export type SpeakEventBase = {
  session_id: string;
  ts_ms: number;
};

export type SpeakEvent =
  | (SpeakEventBase & {
      type: "mic.permission";
      state: MicPermissionState;
      device_id: string | null;
    })
  | (SpeakEventBase & { type: "mic.level"; rms_db: number; vad_prob: number })
  | (SpeakEventBase & { type: "vad.speech_start"; vad_prob: number; duration_ms: number })
  | (SpeakEventBase & { type: "vad.speech_end"; vad_prob: number; duration_ms: number })
  | (SpeakEventBase & {
      type: "bargein";
      source: BargeInSource;
      tts_utterance_id: string | null;
    })
  | (SpeakEventBase & {
      type: "session.start";
      reason: SessionReason;
      prev_session_id?: string;
    })
  | (SpeakEventBase & {
      type: "session.resume";
      reason: SessionReason;
      prev_session_id?: string;
    })
  | (SpeakEventBase & {
      type: "session.end";
      reason: SessionReason;
      prev_session_id?: string;
    })
  | (SpeakEventBase & { type: "tts.start"; utterance_id: string })
  | (SpeakEventBase & { type: "tts.chunk_played"; utterance_id: string })
  | (SpeakEventBase & { type: "tts.end"; utterance_id: string })
  | (SpeakEventBase & { type: "stt.partial"; text: string; latency_ms: number })
  | (SpeakEventBase & { type: "stt.final"; text: string; latency_ms: number })
  | (SpeakEventBase & { type: "pipeline.mode"; mode: PipelineMode });

export type PipelineInbound =
  | { type: "tts.start"; utterance_id: string }
  | { type: "tts.chunk_played"; utterance_id: string }
  | { type: "tts.end"; utterance_id: string }
  | { type: "stt.partial"; text: string; latency_ms: number }
  | { type: "stt.final"; text: string; latency_ms: number }
  | { type: "pipeline.mode"; mode: PipelineMode };

/** Drop the fields speak state stamps onto every event. Distributes over the union. */
type WithoutStamp<T> = T extends unknown ? Omit<T, "session_id" | "ts_ms"> : never;
export type SpeakEventBody = WithoutStamp<SpeakEvent>;

export function isPipelineEvent(
  event: SpeakEvent,
): event is Extract<SpeakEvent, { type: PipelineInbound["type"] }> {
  return (
    event.type === "tts.start" ||
    event.type === "tts.chunk_played" ||
    event.type === "tts.end" ||
    event.type === "stt.partial" ||
    event.type === "stt.final" ||
    event.type === "pipeline.mode"
  );
}
