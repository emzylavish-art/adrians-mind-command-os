/**
 * Shared pointer to the owner's active BuildSession (Logic Bot lane).
 * Build UI / Logic panel should call setActiveBuildSessionId when a session
 * starts or ends. Voice reads it to decide whether finals steer the build.
 */

export const ACTIVE_BUILD_SESSION_STORAGE_KEY = "amcos.buildSession.activeId";

export type ActiveBuildSessionSnapshot = {
  id: string | null;
  /** planning | running | waiting — null when cleared / unknown */
  status: string | null;
  updatedAt: number;
};

type Listener = (snap: ActiveBuildSessionSnapshot) => void;

let memory: ActiveBuildSessionSnapshot = { id: null, status: null, updatedAt: 0 };
const listeners = new Set<Listener>();

function readStorage(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACTIVE_BUILD_SESSION_STORAGE_KEY);
    const id = (raw || "").trim();
    return id || null;
  } catch {
    return null;
  }
}

function writeStorage(id: string | null) {
  if (typeof localStorage === "undefined") return;
  try {
    if (!id) localStorage.removeItem(ACTIVE_BUILD_SESSION_STORAGE_KEY);
    else localStorage.setItem(ACTIVE_BUILD_SESSION_STORAGE_KEY, id);
  } catch {
    /* ignore quota */
  }
}

function emit() {
  for (const listener of listeners) listener(memory);
}

/** Call when BuildSessionPanel (or start response) has a live non-terminal session. */
export function setActiveBuildSessionId(
  id: string | null,
  status: string | null = id ? "running" : null,
): void {
  const nextId = id && id.trim() ? id.trim() : null;
  memory = {
    id: nextId,
    status: nextId ? status : null,
    updatedAt: Date.now(),
  };
  writeStorage(nextId);
  emit();
}

export function getActiveBuildSessionId(
  storage: Pick<Storage, "getItem"> | null | undefined =
    typeof localStorage === "undefined" ? null : localStorage,
): string | null {
  if (memory.id) return memory.id;
  if (!storage) return null;
  try {
    const raw = storage.getItem(ACTIVE_BUILD_SESSION_STORAGE_KEY);
    const id = (raw || "").trim();
    return id || null;
  } catch {
    return null;
  }
}

export function getActiveBuildSessionSnapshot(): ActiveBuildSessionSnapshot {
  if (!memory.id) {
    const fromStore = readStorage();
    if (fromStore) {
      memory = { id: fromStore, status: memory.status, updatedAt: Date.now() };
    }
  }
  return memory;
}

export function subscribeActiveBuildSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isBuildSessionSteerableStatus(status: string | null | undefined): boolean {
  return status === "planning" || status === "running" || status === "waiting";
}
