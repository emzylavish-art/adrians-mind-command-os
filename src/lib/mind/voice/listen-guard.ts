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
