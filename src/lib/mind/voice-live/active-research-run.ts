/**
 * Active deep/search research run pointer for voice chrome (research-layer N5).
 * States match data-research-state: Search | Deep | Running | Done.
 */

export const ACTIVE_RESEARCH_STORAGE_KEY = "amcos.research.active";
export const RESEARCH_REPORT_OVERLAY_KEY = "amcos.research.reportOverlayOpen";

export type ResearchVoiceState = "Search" | "Deep" | "Running" | "Done";

export type ActiveResearchSnapshot = {
  id: string | null;
  state: ResearchVoiceState | null;
  /** Report overlay open (Esc closes this without aborting Running). */
  reportOverlayOpen: boolean;
  pendingSteers: string[];
  abortRequested: boolean;
  updatedAt: number;
};

type Listener = (snap: ActiveResearchSnapshot) => void;

let memory: ActiveResearchSnapshot = {
  id: null,
  state: null,
  reportOverlayOpen: false,
  pendingSteers: [],
  abortRequested: false,
  updatedAt: 0,
};
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(memory);
}

export function subscribeActiveResearch(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActiveResearchSnapshot(): ActiveResearchSnapshot {
  return memory;
}

export function setActiveResearchRun(
  id: string | null,
  state: ResearchVoiceState | null = id ? "Running" : null,
): void {
  memory = {
    ...memory,
    id: id && id.trim() ? id.trim() : null,
    state: id ? state : null,
    abortRequested: id ? memory.abortRequested : false,
    pendingSteers: id ? memory.pendingSteers : [],
    updatedAt: Date.now(),
  };
  if (typeof localStorage !== "undefined") {
    try {
      if (!memory.id) localStorage.removeItem(ACTIVE_RESEARCH_STORAGE_KEY);
      else localStorage.setItem(ACTIVE_RESEARCH_STORAGE_KEY, JSON.stringify({ id: memory.id, state: memory.state }));
    } catch { /* ignore */ }
  }
  emit();
}

export function setResearchReportOverlayOpen(open: boolean): void {
  memory = { ...memory, reportOverlayOpen: open, updatedAt: Date.now() };
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(RESEARCH_REPORT_OVERLAY_KEY, open ? "1" : "0");
    } catch { /* ignore */ }
  }
  emit();
}

export function isResearchInFlight(state: ResearchVoiceState | null | undefined): boolean {
  return state === "Search" || state === "Deep" || state === "Running";
}

/** Queue a final voice transcript as a research steer (applied by research UI / next step). */
export function queueResearchSteer(text: string): { ok: true; count: number } | { ok: false; error: string } {
  const clean = text.trim().slice(0, 4000);
  if (!clean) return { ok: false, error: "Steer message is empty." };
  if (!memory.id || !isResearchInFlight(memory.state)) {
    return { ok: false, error: "No active research run to steer." };
  }
  if (memory.pendingSteers.length >= 20) {
    return { ok: false, error: "Too many pending research steers." };
  }
  memory = {
    ...memory,
    pendingSteers: [...memory.pendingSteers, clean],
    updatedAt: Date.now(),
  };
  emit();
  return { ok: true, count: memory.pendingSteers.length };
}

export function takeResearchSteers(): string[] {
  const steers = memory.pendingSteers;
  if (!steers.length) return [];
  memory = { ...memory, pendingSteers: [], updatedAt: Date.now() };
  emit();
  return steers;
}

/**
 * Request abort of in-flight deep research.
 * Only End (confirmed) or Halt should call this — not barge-in / mute / Esc-overlay.
 */
export function requestResearchAbort(reason: "end" | "halt"): void {
  if (!memory.id) return;
  memory = {
    ...memory,
    abortRequested: true,
    state: reason === "halt" ? memory.state : memory.state,
    updatedAt: Date.now(),
  };
  emit();
}

export function researchAbortRequested(): boolean {
  return memory.abortRequested;
}

/** Esc policy: close report overlay first; do not abort Running unless halt. */
export function decideResearchEscape(input: {
  key: string;
  reportOverlayOpen: boolean;
  researchState: ResearchVoiceState | null;
  haltOn: boolean;
  topmostModalOpen: boolean;
}): { action: "ignore" | "yield_modal" | "close_overlay" | "abort_and_close" | "fallthrough" } {
  if (input.key !== "Escape") return { action: "ignore" };
  if (input.topmostModalOpen) return { action: "yield_modal" };
  if (input.reportOverlayOpen) {
    if (input.haltOn && isResearchInFlight(input.researchState)) {
      return { action: "abort_and_close" };
    }
    return { action: "close_overlay" };
  }
  return { action: "fallthrough" };
}
