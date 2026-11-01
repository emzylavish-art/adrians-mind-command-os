import { isEditableKeyboardTarget, matchesVoiceToggleShortcut } from "./shortcut.ts";

/** Hold Space to talk. Taps shorter than this threshold are ignored (ms). */
export const HOLD_TO_TALK_TAP_THRESHOLD_MS = 180;

export const HOLD_TO_TALK_KEY = " ";

function tagNameOf(target: EventTarget | null): string {
  if (!target || typeof target !== "object") return "";
  const el = target as { tagName?: unknown; nodeName?: unknown };
  const raw = typeof el.tagName === "string" ? el.tagName : typeof el.nodeName === "string" ? el.nodeName : "";
  return raw.toUpperCase();
}

/** Space must not fire hold-to-talk in inputs, textareas, selects, contenteditable, or buttons. */
export function isHoldToTalkBlockedTarget(target: EventTarget | null): boolean {
  if (isEditableKeyboardTarget(target)) return true;
  const tag = tagNameOf(target);
  if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return true;
  if (!target || typeof target !== "object") return false;
  const el = target as { closest?: (selector: string) => unknown; getAttribute?: (name: string) => string | null };
  if (typeof el.closest === "function") {
    try {
      if (el.closest("button, a, [role='button'], [role='textbox'], [contenteditable='true']")) return true;
    } catch {
      /* ignore */
    }
  }
  if (typeof el.getAttribute === "function") {
    const role = el.getAttribute("role");
    if (role === "button" || role === "textbox" || role === "combobox") return true;
  }
  return false;
}

export function isHoldToTalkSpaceKey(event: { key?: string; code?: string }): boolean {
  return event.key === " " || event.key === "Spacebar" || event.code === "Space";
}

/**
 * Returns whether a keydown should begin hold-to-talk.
 * Ignores auto-repeat, editable/button targets, and Ctrl+Shift+V (toggle remains separate).
 */
export function shouldBeginHoldToTalk(event: {
  key: string;
  code?: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
}): boolean {
  if (matchesVoiceToggleShortcut({
    key: event.key,
    shiftKey: !!event.shiftKey,
    ctrlKey: !!event.ctrlKey,
    metaKey: !!event.metaKey,
    altKey: event.altKey,
  })) {
    return false;
  }
  if (!isHoldToTalkSpaceKey(event)) return false;
  if (event.repeat) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (isHoldToTalkBlockedTarget(event.target ?? null)) return false;
  return true;
}

export function shouldEndHoldToTalk(event: {
  key: string;
  code?: string;
}): boolean {
  return isHoldToTalkSpaceKey(event);
}

/** After keyup, only treat as a real hold if pressed long enough. */
export function heldLongEnough(downAtMs: number, upAtMs: number, thresholdMs = HOLD_TO_TALK_TAP_THRESHOLD_MS): boolean {
  return upAtMs - downAtMs >= thresholdMs;
}

export type HoldToTalkController = {
  onKeyDown: (event: KeyboardEvent) => void;
  onKeyUp: (event: KeyboardEvent) => void;
  onBlurOrHide: () => void;
  dispose: () => void;
  isHolding: () => boolean;
};

/**
 * Wire Space hold-to-talk. start() / stop() are invoked only for holds past the tap threshold
 * (start on threshold crossed while still down, or stop on release after a real hold).
 * Ctrl+Shift+V is left alone for the existing toggle path.
 */
export function createHoldToTalkController(input: {
  start: () => void;
  stop: () => void;
  isListening: () => boolean;
  now?: () => number;
  thresholdMs?: number;
}): HoldToTalkController {
  const now = input.now ?? (() => Date.now());
  const threshold = input.thresholdMs ?? HOLD_TO_TALK_TAP_THRESHOLD_MS;
  let downAt: number | null = null;
  let armed = false;
  let holdStarted = false;
  let thresholdTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (thresholdTimer != null) {
      clearTimeout(thresholdTimer);
      thresholdTimer = null;
    }
  };

  const cancelPending = () => {
    clearTimer();
    downAt = null;
    armed = false;
  };

  const forceStopIfHolding = () => {
    clearTimer();
    const wasHolding = holdStarted;
    downAt = null;
    armed = false;
    holdStarted = false;
    if (wasHolding && input.isListening()) input.stop();
  };

  return {
    onKeyDown(event) {
      if (!shouldBeginHoldToTalk(event)) return;
      if (downAt != null) return;
      event.preventDefault();
      downAt = now();
      armed = true;
      holdStarted = false;
      clearTimer();
      thresholdTimer = setTimeout(() => {
        thresholdTimer = null;
        if (!armed || downAt == null) return;
        if (!heldLongEnough(downAt, now(), threshold)) return;
        holdStarted = true;
        if (!input.isListening()) input.start();
      }, threshold);
    },
    onKeyUp(event) {
      if (!shouldEndHoldToTalk(event)) return;
      if (!armed) return;
      event.preventDefault();
      const started = holdStarted;
      cancelPending();
      holdStarted = false;
      if (started) {
        if (input.isListening()) input.stop();
      }
      // Tap below threshold: ignore (do not toggle).
    },
    onBlurOrHide() {
      forceStopIfHolding();
    },
    dispose() {
      forceStopIfHolding();
    },
    isHolding() {
      return holdStarted;
    },
  };
}
