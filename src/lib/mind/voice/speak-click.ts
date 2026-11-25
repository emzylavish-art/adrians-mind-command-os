/**
 * Callbacks mounted at command-app speak().
 * A newer attempt or dismiss drops a late result. A committed chat turn is not sent again.
 */
import { createElement } from "react";
import { VOICE_SIGN_IN_REQUIRED } from "./errors.ts";
import { speakCanRetry } from "./speak-failures.ts";
import {
  classifySpeakFailure,
  runSpeakAction,
  snapshotSpeakRetryParams,
  type SpeakActionDeps,
  type SpeakRetryParams,
} from "./speak-action.ts";

export const SPEAK_SESSION_TIMEOUT_MS = 10_000;
export const SPEAK_SESSION_TIMEOUT_MESSAGE = "Getting session timed out. Nothing was started.";

export class SpeakSessionTimeoutError extends Error {
  constructor() {
    super(SPEAK_SESSION_TIMEOUT_MESSAGE);
    this.name = "TimeoutError";
  }
}

/** Settle a session mint that never resolves. Abort stays an AbortError. */
export async function withSessionTimeout<T>(work: () => Promise<T>, ms = SPEAK_SESSION_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new SpeakSessionTimeoutError()), ms);
      }),
      new Promise<T>((_, reject) => {
        if (!signal) return;
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type SpeakPhase = "off" | "getting_session" | "listening" | "processing" | "speaking" | "error";

export type SpeakUiState = {
  generation: number;
  phase: SpeakPhase;
  error: string | null;
  notice: string | null;
  correlationId: string;
  attempt: SpeakRetryParams;
  dismissed: boolean;
};

export type SpeakGeneration = { current: number };

export function createSpeakUi(): SpeakUiState {
  const attempt = snapshotSpeakRetryParams({});
  return {
    generation: 0,
    phase: "off",
    error: null,
    notice: null,
    correlationId: attempt.correlationId,
    attempt,
    dismissed: false,
  };
}

export type SpeakPressInput = {
  text: string;
  mode: "new" | "retry";
  signedIn: boolean;
  deps: SpeakActionDeps;
  onPhase?: (phase: SpeakPhase) => void;
};

export type SpeakPressResult = SpeakUiState & { applied: boolean };

function readAloudParams(text: string): SpeakRetryParams {
  return snapshotSpeakRetryParams({
    chatCommitted: true,
    reply: text.trim(),
  });
}

/** The function command-app speak() calls. */
export async function pressSpeak(gen: SpeakGeneration, ui: SpeakUiState, input: SpeakPressInput): Promise<SpeakPressResult> {
  const mine = ++gen.current;
  const params = input.mode === "retry"
    ? snapshotSpeakRetryParams(ui.attempt)
    : input.text.trim()
      ? readAloudParams(input.text)
      : snapshotSpeakRetryParams({});
  const phase: SpeakPhase = params.chatCommitted ? "speaking" : "getting_session";
  const started: SpeakUiState = {
    ...ui,
    generation: mine,
    phase,
    error: null,
    notice: null,
    correlationId: params.correlationId,
    attempt: params,
    dismissed: false,
  };
  input.onPhase?.(phase);
  if (mine !== gen.current) return { ...ui, applied: false };

  if (!input.signedIn && !params.chatCommitted) {
    const classified = classifySpeakFailure({ ok: false, code: "unauthorized", error: VOICE_SIGN_IN_REQUIRED });
    const next: SpeakUiState = { ...started, phase: "error", error: classified.message };
    return { ...next, applied: mine === gen.current };
  }

  const deps: SpeakActionDeps = params.chatCommitted
    ? { synthesize: input.deps.synthesize, play: input.deps.play }
    : input.deps;
  let result;
  try {
    result = await runSpeakAction(params, deps);
  } catch (caught) {
    if (mine !== gen.current) return { ...ui, applied: false };
    const classified = classifySpeakFailure(caught);
    return { ...started, phase: "error", error: classified.message, attempt: params, applied: true };
  }
  if (mine !== gen.current) return { ...ui, applied: false };
  if (result.ok) {
    return {
      ...started,
      phase: "off",
      error: null,
      notice: result.replayed ? "Spoke the same reply again." : "Spoke the chat reply.",
      attempt: result.params,
      correlationId: result.params.correlationId,
      applied: true,
    };
  }
  return {
    ...started,
    phase: "error",
    error: result.message,
    notice: null,
    attempt: result.params,
    correlationId: result.params.correlationId,
    applied: true,
  };
}

/** Dismiss clears the visible error and invalidates an in-flight attempt. */
export function dismissSpeak(gen: SpeakGeneration, ui: SpeakUiState): SpeakUiState {
  gen.current += 1;
  return {
    ...ui,
    generation: gen.current,
    phase: "off",
    error: null,
    notice: null,
    dismissed: true,
  };
}

export type SpeakMountedInput = {
  text: string;
  messageId: string;
  voiceId: string;
  replay?: SpeakRetryParams;
  isCurrent: () => boolean;
  deps: SpeakActionDeps;
  reportFailure: (message: string, action: string, target: string, retry: (() => void) | null) => void;
  clearFailure: () => void;
  again: (params: SpeakRetryParams) => void;
};

/** What command-app speak() runs. Failures go through classifySpeakFailure and reportFailure. */
export async function runMountedSpeak(input: SpeakMountedInput): Promise<{ ok: boolean; params: SpeakRetryParams }> {
  const params = input.replay
    ? snapshotSpeakRetryParams(input.replay)
    : snapshotSpeakRetryParams({
        text: input.text,
        messageId: input.messageId,
        voiceId: input.voiceId,
        chatCommitted: input.text.length > 0,
        reply: input.text.length > 0 ? input.text : null,
      });
  if (!input.isCurrent()) return { ok: false, params };
  input.clearFailure();
  const sourceDeps: SpeakActionDeps = params.chatCommitted
    ? { synthesize: input.deps.synthesize, play: input.deps.play }
    : input.deps;
  const canceled = (): { ok: false; error: string } => ({ ok: false, error: "Speak attempt was canceled." });
  const guard = <T>(run: (() => Promise<T>) | undefined): (() => Promise<T | { ok: false; error: string }>) | undefined => run ? async () => {
    if (!input.isCurrent()) return canceled();
    const result = await run();
    return input.isCurrent() ? result : canceled();
  } : undefined;
  const guardInput = <T>(run: ((value: T) => Promise<unknown>) | undefined): ((value: T) => Promise<unknown>) | undefined => run ? async (value) => {
    if (!input.isCurrent()) return canceled();
    const result = await run(value);
    return input.isCurrent() ? result : canceled();
  } : undefined;
  const guardTwo = <T, U>(run: ((a: T, b: U) => Promise<unknown>) | undefined): ((a: T, b: U) => Promise<unknown>) | undefined => run ? async (a, b) => {
    if (!input.isCurrent()) return canceled();
    const result = await run(a, b);
    return input.isCurrent() ? result : canceled();
  } : undefined;
  const guardPlay = (run: ((value: string) => Promise<void>) | undefined): ((value: string) => Promise<void>) | undefined => run ? async (value) => {
    if (!input.isCurrent()) return;
    await run(value);
  } : undefined;
  const deps: SpeakActionDeps = {
    session: guard(sourceDeps.session),
    capture: guard(sourceDeps.capture),
    transcribe: guardTwo(sourceDeps.transcribe),
    chatTurn: guardInput(sourceDeps.chatTurn),
    synthesize: guardTwo(sourceDeps.synthesize),
    play: guardPlay(sourceDeps.play),
  };
  let result;
  try {
    result = await runSpeakAction(params, deps);
  } catch (caught) {
    if (!input.isCurrent()) return { ok: false, params };
    const classified = classifySpeakFailure(caught);
    input.reportFailure(
      classified.message,
      classified.kind,
      params.messageId || "speak",
      speakCanRetry(classified.message, params) ? () => input.again(snapshotSpeakRetryParams(params)) : null,
    );
    return { ok: false, params };
  }
  if (!input.isCurrent()) return { ok: false, params };
  if (!result.ok) {
    const classified = classifySpeakFailure({ ok: false, error: result.message });
    const message = classified.message || result.message;
    input.reportFailure(
      message,
      classified.kind,
      result.params.messageId || "speak",
      speakCanRetry(message, result.params) ? () => input.again(snapshotSpeakRetryParams(result.params)) : null,
    );
    return { ok: false, params: result.params };
  }
  input.clearFailure();
  return { ok: true, params: result.params };
}
export function SpeakLiveControl(props: {
  phase: SpeakPhase;
  error: string | null;
  notice: string | null;
  retryable?: boolean;
  onSpeak: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const connectionError = /connection|network/i.test(props.error ?? "");
  const label = props.phase === "getting_session"
    ? "Getting session…"
    : props.phase === "listening"
      ? "Listening…"
      : props.phase === "processing"
        ? "Thinking…"
        : props.phase === "speaking"
          ? "Speaking…"
          : props.phase === "error"
            ? connectionError ? "Connection failed" : "Speak failed"
            : "Speak";
  return createElement(
    "div",
    {
      "data-testid": "composer-voice-live",
      "data-state": props.phase,
      role: "region",
      "aria-label": "Speak",
      style: {
        position: "fixed",
        zIndex: 60,
        right: "0.75rem",
        bottom: "calc(4.75rem + env(safe-area-inset-bottom, 0px))",
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
        maxWidth: "16rem",
      },
    },
    createElement("p", { "data-testid": "composer-voice-live-state", role: "status" }, label),
    props.error ? createElement("p", { "data-testid": "composer-voice-live-error", role: "alert" }, props.error) : null,
    props.notice ? createElement("p", { "data-testid": "composer-voice-live-notice" }, props.notice) : null,
    createElement(
      "button",
      { type: "button", "data-testid": "composer-speak", onClick: props.onSpeak },
      "Speak",
    ),
    props.phase === "error" && props.retryable
      ? createElement(
          "button",
          { type: "button", "data-testid": "composer-voice-live-retry", onClick: props.onRetry },
          "Retry",
        )
      : null,
    createElement(
      "button",
      { type: "button", "data-testid": "composer-voice-live-dismiss", onClick: props.onDismiss },
      "Dismiss",
    ),
  );
}
