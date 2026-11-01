/** Prevent duplicate Start-voice sessions from mic/shortcut spam. */

export type ListenGuard = {
  begin: () => boolean;
  end: () => void;
  get busy(): boolean;
};

export function createListenGuard(): ListenGuard {
  let busy = false;
  return {
    begin() {
      if (busy) return false;
      busy = true;
      return true;
    },
    end() {
      busy = false;
    },
    get busy() {
      return busy;
    },
  };
}

export type ListenInvokeMode = "toggle" | "start" | "stop";

/**
 * Decide whether an invoke should start, stop, or ignore.
 * `start` never toggles off an in-flight mint/connect (PTT + reconnect race fix).
 */
export function resolveListenAction(
  mode: ListenInvokeMode,
  active: boolean,
): "start" | "stop" | "ignore" {
  if (mode === "stop" || (mode === "toggle" && active)) return "stop";
  if (mode === "start" && active) return "ignore";
  return "start";
}
