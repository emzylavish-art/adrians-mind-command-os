import { isEditableKeyboardTarget, matchesVoiceToggleShortcut } from "./shortcut.ts";

/** Hold Space to talk. Taps shorter than this threshold are ignored (ms). */
export const HOLD_TO_TALK_TAP_THRESHOLD_MS = 180;

export const HOLD_TO_TALK_KEY = " ";

/**
 * ARIA roles that use Space as the native activation / control key.
 * Holding Space on these must never open the mic (H14).
 */
export const HOLD_TO_TALK_BLOCKED_ROLES = [
  "tab",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "listbox",
  "combobox",
  "treeitem",
  "gridcell",
  "button",
  "link",
  "summary",
  "searchbox",
  "textbox",
] as const;

const BLOCKED_ROLE_SET = new Set<string>(HOLD_TO_TALK_BLOCKED_ROLES);

/** Selector for closest() — interactive hosts + open modal ancestors. */
export const HOLD_TO_TALK_BLOCKED_CLOSEST =
  "button, a, summary, input, textarea, select, [contenteditable='true'], [role='button'], [role='link'], [role='tab'], [role='option'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='checkbox'], [role='radio'], [role='switch'], [role='slider'], [role='spinbutton'], [role='listbox'], [role='combobox'], [role='treeitem'], [role='gridcell'], [role='summary'], [role='searchbox'], [role='textbox'], [aria-modal='true'], [role='dialog'], [role='alertdialog']";

function tagNameOf(target: EventTarget | null): string {
  if (!target || typeof target !== "object") return "";
  const el = target as { tagName?: unknown; nodeName?: unknown };
  const raw = typeof el.tagName === "string" ? el.tagName : typeof el.nodeName === "string" ? el.nodeName : "";
  return raw.toUpperCase();
}

function roleOf(el: { getAttribute?: (name: string) => string | null }): string {
  if (typeof el.getAttribute !== "function") return "";
  try {
    return (el.getAttribute("role") || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

/**
 * True when the document has an open modal dialog (Cmd-K palette, confirms, sheets).
 * Safe for jsdom/node stubs when document/querySelector is missing.
 */
export function isVoiceModalOpen(doc: {
  querySelector?: (selectors: string) => unknown;
} | null = typeof document !== "undefined" ? document : null): boolean {
  if (!doc || typeof doc.querySelector !== "function") return false;
  try {
    return Boolean(
      doc.querySelector("[aria-modal='true'], [role='dialog'], [role='alertdialog']"),
    );
  } catch {
    return false;
  }
}

/** Space must not fire hold-to-talk on editables, buttons/links, ARIA widgets, or inside modals. */
export function isHoldToTalkBlockedTarget(target: EventTarget | null): boolean {
  if (isEditableKeyboardTarget(target)) return true;
  const tag = tagNameOf(target);
  if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return true;
  if (!target || typeof target !== "object") return false;
  const el = target as {
    isContentEditable?: unknown;
    closest?: (selector: string) => unknown;
    getAttribute?: (name: string) => string | null;
  };
  if (el.isContentEditable === true) return true;
  const ownRole = roleOf(el);
  if (ownRole && BLOCKED_ROLE_SET.has(ownRole)) return true;
  if (typeof el.closest === "function") {
    try {
      if (el.closest(HOLD_TO_TALK_BLOCKED_CLOSEST)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export function isHoldToTalkSpaceKey(event: { key?: string; code?: string }): boolean {
  return event.key === " " || event.key === "Spacebar" || event.code === "Space";
}

/**
 * Returns whether a keydown should begin hold-to-talk.
 * Ignores auto-repeat, ARIA/editable targets, open modals, and Ctrl+Shift+V.
 */
export function shouldBeginHoldToTalk(
  event: {
    key: string;
    code?: string;
    repeat?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    target?: EventTarget | null;
  },
  doc?: { querySelector?: (selectors: string) => unknown } | null,
): boolean {
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
  if (isVoiceModalOpen(doc)) return false;
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

/**
 * Ctrl/Cmd+Shift+V must not toggle voice while a modal dialog is open (H14).
 * Still matches the key chord; callers gate with this helper.
 */
export function shouldToggleVoiceShortcut(
  event: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey?: boolean;
    target?: EventTarget | null;
  },
  doc?: { querySelector?: (selectors: string) => unknown } | null,
): boolean {
  if (!matchesVoiceToggleShortcut(event)) return false;
  if (isEditableKeyboardTarget(event.target ?? null)) return false;
  if (isVoiceModalOpen(doc)) return false;
  return true;
}

export type HoldToTalkController = {
  onKeyDown: (event: KeyboardEvent) => void;
  onKeyUp: (event: KeyboardEvent) => void;
  onBlurOrHide: () => void;
  dispose: () => void;
  isHolding: () => boolean;
};

/**
 * Wire Space hold-to-talk. start() / stop() are invoked only for holds past the tap threshold.
 * stop() always runs on release after a real hold (cancels in-flight mint too).
 * Ctrl+Shift+V is left to the separate toggle path (also modal-gated).
 */
export function createHoldToTalkController(input: {
  start: () => void;
  stop: () => void;
  /** True when a session is up OR a start/mint is in flight (so release can cancel). */
  isListening: () => boolean;
  now?: () => number;
  thresholdMs?: number;
  getDocument?: () => { querySelector?: (selectors: string) => unknown } | null;
}): HoldToTalkController {
  const now = input.now ?? (() => Date.now());
  const threshold = input.thresholdMs ?? HOLD_TO_TALK_TAP_THRESHOLD_MS;
  const getDocument =
    input.getDocument ??
    (() => (typeof document !== "undefined" ? document : null));
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
    if (wasHolding) input.stop();
  };

  return {
    onKeyDown(event) {
      if (!shouldBeginHoldToTalk(event, getDocument())) return;
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
        // Modal may have opened after keydown (e.g. palette); re-check.
        if (isVoiceModalOpen(getDocument())) {
          cancelPending();
          holdStarted = false;
          return;
        }
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
        // Always stop/cancel on release after a real hold (including in-flight mint).
        input.stop();
      }
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
