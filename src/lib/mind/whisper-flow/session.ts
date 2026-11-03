/**
 * Whisper Flow session: browser SpeechRecognition is the primary live path.
 * MediaRecorder + server STT is used only when browser speech is unsupported or fails.
 * Finalized segments go through command parsing → local refine → caret insert.
 * Optional LLM refine is non-blocking and toggleable.
 */

import { captureInsertTarget, insertTextAtCaret, type InsertTarget } from "./insert.ts";
import { parseVoiceCommands, commandToInsert, type VoiceCommand } from "./commands.ts";
import { refineDictationLocal } from "./refine.ts";
import {
  createWhisperFlowState,
  finishWhisperFlow,
  reduceWhisperFlow,
} from "./machine.ts";
import type { WhisperFlowState } from "./types.ts";
import { whisperFlowSupported, mapWhisperMicError, WHISPER_UNSUPPORTED } from "./errors.ts";
import { createWhisperCapture, type WhisperCapture } from "./capture.ts";
import { transcribeWhisperChunk, type TranscribeFn } from "./client.ts";

export type BrowserSpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((event: BrowserSpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

export type BrowserSpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal?: boolean; 0?: { transcript?: string } } | undefined>;
};

export type BrowserSpeechCtor = new () => BrowserSpeechRec;

export type WhisperSessionHandlers = {
  onState: (state: WhisperFlowState) => void;
  onInterim?: (text: string) => void;
  /** Called after a segment is inserted (refined). */
  onInserted?: (text: string) => void;
  /** Undo last committed segment (scratch/delete). */
  onUndoLastSegment?: () => void;
  onSelectAll?: () => void;
  /** Optional async LLM refine; must not block — fire-and-forget. */
  llmRefine?: (text: string) => Promise<string | null>;
  llmRefineEnabled?: boolean;
  transcribe?: TranscribeFn;
  speechCtor?: () => BrowserSpeechCtor | null;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
};

export type WhisperSession = {
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  cancel: () => void;
  getState: () => WhisperFlowState;
  /** Segments committed this session (for undo). */
  segments: string[];
};

function defaultSpeechCtor(): BrowserSpeechCtor | null {
  const w = globalThis as unknown as {
    SpeechRecognition?: BrowserSpeechCtor;
    webkitSpeechRecognition?: BrowserSpeechCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function applyCommandsAndRefine(
  raw: string,
  opts: { addPunctuation?: boolean },
): {
  insertPieces: string[];
  commands: VoiceCommand[];
  discardSegment: boolean;
  undoPrevious: boolean;
  refined: string;
} {
  const parsed = parseVoiceCommands(raw);
  const hasScratchCmd = parsed.commands.some(
    (c) => c.kind === "scratch_that" || c.kind === "delete_that",
  );
  const insertPieces: string[] = [];
  for (const cmd of parsed.commands) {
    // Control commands are not insertable as text.
    if (cmd.kind === "scratch_that" || cmd.kind === "delete_that") continue;
    const piece = commandToInsert(cmd.kind);
    if (piece) insertPieces.push(piece);
  }
  // If the utterance was only a scratch/delete command, discard + undo.
  if (hasScratchCmd && !parsed.text.trim()) {
    return {
      insertPieces: [],
      commands: parsed.commands,
      discardSegment: true,
      undoPrevious: true,
      refined: "",
    };
  }
  const refined = refineDictationLocal(parsed.text, opts);
  if (refined.discardSegment) {
    return {
      insertPieces: [],
      commands: parsed.commands,
      discardSegment: true,
      undoPrevious: true,
      refined: "",
    };
  }
  if (refined.text) insertPieces.push(refined.text);
  return {
    insertPieces,
    commands: parsed.commands,
    discardSegment: false,
    undoPrevious: refined.undoPrevious || hasScratchCmd,
    refined: refined.text,
  };
}

export function createWhisperSession(handlers: WhisperSessionHandlers): WhisperSession {
  let state = createWhisperFlowState();
  const segments: string[] = [];
  let target: InsertTarget = { kind: "none" };
  let rec: BrowserSpeechRec | null = null;
  let capture: WhisperCapture | null = null;
  let mode: "browser" | "stt" | "none" = "none";
  let userStopped = false;
  let paused = false;
  let finalBuffer = "";
  let levelTimer: ReturnType<typeof setInterval> | null = null;
  let abortTranscribe: AbortController | null = null;

  const setState = (next: WhisperFlowState) => {
    state = next;
    handlers.onState(next);
  };
  const dispatch = (action: Parameters<typeof reduceWhisperFlow>[1]) => {
    setState(reduceWhisperFlow(state, action));
  };

  const clearLevel = () => {
    if (levelTimer) clearInterval(levelTimer);
    levelTimer = null;
  };

  const commitSegment = (raw: string) => {
    const result = applyCommandsAndRefine(raw, { addPunctuation: true });

    for (const cmd of result.commands) {
      if (cmd.kind === "pause") {
        pause();
      } else if (cmd.kind === "resume") {
        resume();
      } else if (cmd.kind === "stop") {
        void stop();
      } else if (cmd.kind === "select_all") {
        handlers.onSelectAll?.();
      } else if (cmd.kind === "delete_that" || cmd.kind === "scratch_that") {
        // handled via undoPrevious below
      }
    }

    if (result.undoPrevious || result.discardSegment) {
      if (segments.length) {
        segments.pop();
        handlers.onUndoLastSegment?.();
      }
      if (result.discardSegment) return;
    }

    if (!result.insertPieces.length) return;

    let combined = "";
    for (const piece of result.insertPieces) {
      // Punctuation should not get an extra leading space from insert helper trim rules oddly —
      // insertTextAtCaret trims; for control chars pass through carefully.
      if (piece === "\n" || piece === "\n\n") {
        if (target.kind === "input") {
          const el = target.el;
          const start = typeof el.selectionStart === "number" ? el.selectionStart : el.value.length;
          const end = typeof el.selectionEnd === "number" ? el.selectionEnd : start;
          const value = `${el.value.slice(0, start)}${piece}${el.value.slice(end)}`;
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, "value");
          if (desc?.set) desc.set.call(el, value);
          else el.value = value;
          const caret = start + piece.length;
          try {
            el.setSelectionRange(caret, caret);
          } catch {
            /* ignore */
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          target.start = caret;
          target.end = caret;
        } else if (target.kind === "contenteditable") {
          insertTextAtCaret(target, piece === "\n\n" ? "\n\n" : "\n");
        }
        combined += piece;
        continue;
      }
      if (piece === "." || piece === "," || piece === "?" || piece === "!") {
        if (target.kind === "input") {
          const el = target.el;
          const start = typeof el.selectionStart === "number" ? el.selectionStart : el.value.length;
          const end = typeof el.selectionEnd === "number" ? el.selectionEnd : start;
          // Avoid double spaces before punctuation
          let s = start;
          let v = el.value;
          if (s > 0 && v[s - 1] === " ") {
            // keep
          }
          const value = `${v.slice(0, s)}${piece}${v.slice(end)}`;
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, "value");
          if (desc?.set) desc.set.call(el, value);
          else el.value = value;
          const caret = s + piece.length;
          try {
            el.setSelectionRange(caret, caret);
          } catch {
            /* ignore */
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          target.start = caret;
          target.end = caret;
        } else {
          insertTextAtCaret(target, piece);
        }
        combined += piece;
        continue;
      }
      const inserted = insertTextAtCaret(target, piece);
      if (inserted.ok) combined += (combined && !/^\s/.test(piece) ? " " : "") + inserted.inserted;
    }

    if (result.refined) {
      segments.push(result.refined);
      dispatch({ type: "chunk_ok", text: result.refined });
      handlers.onInserted?.(result.refined);

      if (handlers.llmRefineEnabled && handlers.llmRefine) {
        const snapshot = result.refined;
        void handlers.llmRefine(snapshot).then((better) => {
          // Non-blocking: honest notice only; do not rewrite silently if null/same.
          if (better && better.trim() && better.trim() !== snapshot) {
            handlers.onState({
              ...state,
              status: "Optional LLM refinement available (local text already inserted). Nothing was auto-replaced.",
            });
          }
        }).catch(() => {
          handlers.onState({
            ...state,
            status: "Optional LLM refinement failed. Local refinement was kept. Nothing was invented.",
          });
        });
      }
    } else if (combined) {
      dispatch({ type: "chunk_ok", text: combined });
      handlers.onInserted?.(combined);
    }
  };

  const stopBrowser = () => {
    const r = rec;
    rec = null;
    if (!r) return;
    try {
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      r.stop();
    } catch {
      try {
        r.abort?.();
      } catch {
        /* ignore */
      }
    }
  };

  const startBrowser = (Ctor: BrowserSpeechCtor) => {
    mode = "browser";
    userStopped = false;
    paused = false;
    finalBuffer = "";
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      if (paused) return;
      let interim = "";
      let finals = "";
      for (let i = event.resultIndex || 0; i < event.results.length; i++) {
        const row = event.results[i];
        const transcript = row?.[0]?.transcript ?? "";
        if (row?.isFinal) finals += transcript;
        else interim += transcript;
      }
      if (interim) handlers.onInterim?.(interim.trim());
      if (finals.trim()) {
        finalBuffer = "";
        commitSegment(finals);
      }
      dispatch({ type: "level", level: 0.45 });
    };
    recognition.onerror = (event) => {
      const code = (event.error || "").toLowerCase();
      if (code === "no-speech" || code === "aborted") return;
      if (userStopped) return;
      // Fall back to STT capture if permission/network issues after start — honest error first.
      stopBrowser();
      clearLevel();
      if (code === "not-allowed" || code === "service-not-allowed") {
        dispatch({
          type: "error",
          message:
            "Microphone permission was denied for browser speech. Allow the mic, then Retry. Nothing was transcribed.",
          retryable: true,
        });
        return;
      }
      // Attempt STT fallback when browser speech service fails
      void startSttFallback(
        `Browser speech failed (${code || "error"}). Trying server speech-to-text fallback…`,
      );
    };
    recognition.onend = () => {
      if (userStopped || paused) return;
      if (state.phase !== "listening" && state.phase !== "transcribing") return;
      // Chrome ends continuous sessions periodically — restart while listening.
      try {
        recognition.start();
      } catch {
        /* ignore */
      }
    };
    rec = recognition;
    recognition.start();
    levelTimer = setInterval(() => {
      if (state.phase === "listening") dispatch({ type: "level", level: 0.35 + Math.random() * 0.2 });
    }, 200);
  };

  const startSttFallback = async (statusNote?: string) => {
    const support = whisperFlowSupported();
    if (!support.ok) {
      dispatch({ type: "error", message: support.error, retryable: false });
      return;
    }
    if (!handlers.transcribe) {
      dispatch({
        type: "error",
        message:
          statusNote ||
          "Browser speech is unavailable and no server transcription function was provided. Nothing was transcribed.",
        retryable: true,
      });
      return;
    }
    try {
      mode = "stt";
      if (statusNote) {
        setState({ ...state, phase: "listening", status: statusNote, error: null });
      }
      abortTranscribe = new AbortController();
      capture = await createWhisperCapture({
        getUserMedia: handlers.getUserMedia,
        onChunk: (chunk) => {
          if (paused || userStopped) return;
          dispatch({ type: "chunk_transcribing" });
          void transcribeWhisperChunk(chunk, handlers.transcribe!, {
            signal: abortTranscribe?.signal,
          }).then((result) => {
            if (userStopped) return;
            if (!result.ok) {
              dispatch({ type: "error", message: result.error, retryable: true });
              return;
            }
            // Return to listening after chunk
            if (state.phase === "transcribing" || state.phase === "error") {
              dispatch({ type: "resume" });
            }
            commitSegment(result.text);
          });
        },
        onTrackEnded: () => {
          dispatch({
            type: "error",
            message: "The microphone track ended or the device changed. Whisper Flow stopped.",
            retryable: true,
          });
        },
      });
      await capture.start();
      clearLevel();
      levelTimer = setInterval(() => {
        if (capture && state.phase === "listening") {
          dispatch({ type: "level", level: capture.getLevel() });
        }
      }, 100);
    } catch (err) {
      dispatch({ type: "error", message: mapWhisperMicError(err), retryable: true });
    }
  };

  async function start() {
    if (state.phase !== "idle" && state.phase !== "error") return;
    target = captureInsertTarget();
    dispatch({ type: "start" });
    const Ctor = (handlers.speechCtor || defaultSpeechCtor)();
    if (Ctor) {
      try {
        startBrowser(Ctor);
        return;
      } catch {
        // fall through to STT
      }
    }
    await startSttFallback(
      Ctor
        ? "Browser speech could not start. Using server speech-to-text fallback…"
        : `${WHISPER_UNSUPPORTED} Using server speech-to-text fallback when available…`,
    );
  }

  function pause() {
    if (state.phase !== "listening" && state.phase !== "transcribing") return;
    paused = true;
    dispatch({ type: "pause" });
    if (mode === "browser") stopBrowser();
    if (mode === "stt") capture?.pause();
    clearLevel();
  }

  function resume() {
    if (state.phase !== "paused") return;
    paused = false;
    dispatch({ type: "resume" });
    if (mode === "browser") {
      const Ctor = (handlers.speechCtor || defaultSpeechCtor)();
      if (Ctor) startBrowser(Ctor);
    } else if (mode === "stt") {
      capture?.resume();
      levelTimer = setInterval(() => {
        if (capture && state.phase === "listening") dispatch({ type: "level", level: capture.getLevel() });
      }, 100);
    }
  }

  async function stop() {
    userStopped = true;
    paused = false;
    clearLevel();
    dispatch({ type: "stop_begin" });
    stopBrowser();
    abortTranscribe?.abort();
    if (capture) {
      const last = await capture.stop().catch(() => null);
      capture = null;
      if (last && handlers.transcribe && last.blob.size >= 32) {
        const result = await transcribeWhisperChunk(last, handlers.transcribe);
        if (result.ok) commitSegment(result.text);
      }
    }
    setState(finishWhisperFlow(state));
    mode = "none";
  }

  function cancel() {
    userStopped = true;
    clearLevel();
    stopBrowser();
    abortTranscribe?.abort();
    capture?.cancel();
    capture = null;
    mode = "none";
    dispatch({ type: "reset" });
  }

  return {
    start,
    pause,
    resume,
    stop,
    cancel,
    getState: () => state,
    segments,
  };
}

/** Pure helper exported for unit tests — finalize path without DOM. */
export function processDictationSegment(raw: string): {
  text: string;
  refined: string;
  insertPieces: string[];
  commands: VoiceCommand[];
  discardSegment: boolean;
  undoPrevious: boolean;
} {
  const r = applyCommandsAndRefine(raw, { addPunctuation: true });
  return {
    text: r.refined,
    refined: r.refined,
    insertPieces: r.insertPieces,
    commands: r.commands,
    discardSegment: r.discardSegment,
    undoPrevious: r.undoPrevious,
  };
}
