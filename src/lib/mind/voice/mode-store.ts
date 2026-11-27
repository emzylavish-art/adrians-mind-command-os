import {
  commitVoiceMode,
  parseVoiceMode,
  readStoredVoiceMode,
  VOICE_MODE_STORAGE_KEY,
  type VoiceRoutingMode,
} from "./mode.ts";

type Listener = () => void;

let current: VoiceRoutingMode = "direct";
const listeners = new Set<Listener>();
let storageBound = false;
let storageKey = VOICE_MODE_STORAGE_KEY;

function emit() {
  for (const listener of listeners) listener();
}

function bindStorage() {
  if (storageBound || typeof window === "undefined") return;
  storageBound = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) return;
    const next = parseVoiceMode(event.newValue);
    if (next === current) return;
    current = next;
    emit();
  });
}

/** Call once on the client before first paint when possible. */
export function hydrateVoiceModeStore(storage?: Pick<Storage, "getItem" | "setItem"> | null): VoiceRoutingMode {
  bindStorage();
  const store = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  storageKey = (store as { keyFor?: (key: string) => string } | null)?.keyFor?.(VOICE_MODE_STORAGE_KEY) ?? VOICE_MODE_STORAGE_KEY;
  current = readStoredVoiceMode(store);
  emit();
  return current;
}

export function getVoiceMode(): VoiceRoutingMode {
  return current;
}

export function subscribeVoiceMode(listener: Listener): () => void {
  bindStorage();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setVoiceModeStore(
  next: VoiceRoutingMode,
  storage?: Pick<Storage, "setItem"> | null,
): VoiceRoutingMode {
  const store = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  current = commitVoiceMode(next, store);
  emit();
  return current;
}

/** Server / SSR snapshot — always Direct until client hydrate. */
export function getServerVoiceMode(): VoiceRoutingMode {
  return "direct";
}
