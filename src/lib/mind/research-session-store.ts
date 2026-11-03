import { randomUUID } from "node:crypto";
import {
  type ResearchSession,
  type ResearchSessionStatus,
  type ResearchTimelineEvent,
  RESEARCH_TERMINAL,
} from "./research-session.ts";
import { planDeepQueries, resolveDeepPlan } from "./research.ts";

type Listener = (session: ResearchSession, fromSeq: number) => void;

const sessions = new Map<string, ResearchSession>();
const controllers = new Map<string, AbortController>();
const listeners = new Map<string, Set<Listener>>();

export function resetResearchSessionStoreForTests(): void {
  sessions.clear();
  controllers.clear();
  listeners.clear();
}

export function memoryGetResearch(id: string): ResearchSession | undefined {
  return sessions.get(id);
}

export function researchAbortController(id: string): AbortController | undefined {
  return controllers.get(id);
}

export function subscribeResearch(id: string, listener: Listener): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(id);
  };
}

function notify(session: ResearchSession, fromSeq: number): void {
  const set = listeners.get(session.id);
  if (!set) return;
  for (const listener of [...set]) listener(session, fromSeq);
}

export function appendResearchEvent(
  id: string,
  kind: ResearchTimelineEvent["kind"],
  text: string,
  extra: Partial<Pick<ResearchTimelineEvent, "step" | "index" | "total">> = {},
): ResearchSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  const fromSeq = session.lastSeq;
  const seq = session.lastSeq + 1;
  const event: ResearchTimelineEvent = {
    id: `evt_${seq}`,
    at: new Date().toISOString(),
    kind,
    text: text.slice(0, 500),
    seq,
    ...extra,
  };
  const next: ResearchSession = {
    ...session,
    lastSeq: seq,
    timeline: [...session.timeline, event].slice(-200),
    updatedAt: event.at,
  };
  sessions.set(id, next);
  notify(next, fromSeq);
  return next;
}

export function patchResearchSession(id: string, patch: Partial<ResearchSession>): ResearchSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  const fromSeq = session.lastSeq;
  const next: ResearchSession = {
    ...session,
    ...patch,
    id: session.id,
    ownerId: session.ownerId,
    kind: "research_session",
    updatedAt: new Date().toISOString(),
  };
  sessions.set(id, next);
  notify(next, fromSeq);
  return next;
}

export function startResearchInMemory(input: {
  ownerId: string;
  query: string;
  mode: "search" | "deep";
  plan?: string[] | null;
}): ResearchSession {
  const id = `rs_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const plan =
    input.mode === "deep" ? resolveDeepPlan(input.query, input.plan) : [input.query.trim().slice(0, 300)];
  const now = new Date().toISOString();
  const session: ResearchSession = {
    kind: "research_session",
    id,
    ownerId: input.ownerId,
    query: input.query,
    mode: input.mode,
    plan: plan.length ? plan : planDeepQueries(input.query),
    status: "planning",
    steps: [],
    citations: [],
    summary: "",
    error: "",
    timeline: [],
    startedAt: now,
    updatedAt: now,
    lastSeq: 0,
  };
  sessions.set(id, session);
  controllers.set(id, new AbortController());
  appendResearchEvent(id, "status", `Research session created (${input.mode}).`);
  return sessions.get(id)!;
}

export function cancelResearchInMemory(
  id: string,
  ownerId: string,
): { ok: true; session: ResearchSession } | { ok: false; error: string; status?: number } {
  const session = sessions.get(id);
  if (!session || session.ownerId !== ownerId) {
    return { ok: false, error: "That research session was not found.", status: 404 };
  }
  if (RESEARCH_TERMINAL.has(session.status)) {
    return { ok: false, error: "That research session already finished.", status: 409 };
  }
  const controller = controllers.get(id);
  controller?.abort(new DOMException("Research cancelled by user.", "AbortError"));
  const next = patchResearchSession(id, {
    status: "cancelled" as ResearchSessionStatus,
    cancelled: true,
    error: session.citations.length
      ? ""
      : "Research was cancelled. Partial citations that were already confirmed are kept when present.",
  });
  appendResearchEvent(id, "cancelled", "Cancel requested.");
  return { ok: true, session: next ?? sessions.get(id)! };
}

export function activeResearchCount(ownerId: string): number {
  let n = 0;
  for (const session of sessions.values()) {
    if (session.ownerId === ownerId && !RESEARCH_TERMINAL.has(session.status)) n += 1;
  }
  return n;
}
