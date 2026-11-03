/**
 * In-memory ResearchSession for deep runs with SSE progress + Cancel (AbortSignal).
 * Mirrors BuildSession patterns at a smaller scale. No DB table required for v1.
 */

import type { ResearchCitation, ResearchReport, ResearchResult, ResearchStep, ResearchUpload } from "./research.ts";

export type ResearchSessionStatus = "planning" | "running" | "done" | "failed" | "cancelled";

export const RESEARCH_TERMINAL = new Set<ResearchSessionStatus>(["done", "failed", "cancelled"]);

export type ResearchTimelineEvent = {
  id: string;
  at: string;
  kind: "status" | "step_start" | "step_done" | "partial" | "summary" | "error" | "cancelled";
  text: string;
  seq: number;
  step?: ResearchStep;
  index?: number;
  total?: number;
};

export type ResearchSession = {
  kind: "research_session";
  id: string;
  ownerId: string;
  query: string;
  mode: "search" | "deep";
  plan: string[];
  status: ResearchSessionStatus;
  steps: ResearchStep[];
  citations: ResearchCitation[];
  summary: string;
  error: string;
  partial?: boolean;
  cancelled?: boolean;
  report?: ResearchReport;
  timeline: ResearchTimelineEvent[];
  startedAt: string;
  updatedAt: string;
  lastSeq: number;
};

export type PublicResearchSession = Omit<ResearchSession, "ownerId">;

export function publicResearchSession(session: ResearchSession): PublicResearchSession {
  const { ownerId: _ownerId, ...rest } = session;
  return rest;
}

export function sanitizeResearchId(raw: unknown): { ok: true; id: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "Research session id is required." };
  const id = raw.trim().slice(0, 80);
  if (!/^[\w-]+$/.test(id)) return { ok: false, error: "Research session id is invalid." };
  return { ok: true, id };
}

export function sanitizeResearchQuery(raw: unknown): { ok: true; query: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "Write what you want researched." };
  return { ok: true, query: raw.trim().slice(0, 300) };
}

export function sanitizeResearchPlan(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 5);
}

export function sanitizeResearchUploads(raw: unknown): ResearchUpload[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ResearchUpload[] = [];
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim().slice(0, 200) : "";
    const mime = typeof rec.mime === "string" ? rec.mime.trim().slice(0, 120) : "application/octet-stream";
    const bytes = typeof rec.bytes === "number" && Number.isFinite(rec.bytes) ? Math.max(0, Math.floor(rec.bytes)) : 0;
    const excerpts = Array.isArray(rec.excerpts)
      ? rec.excerpts.filter((e): e is string => typeof e === "string").map((e) => e.trim().slice(0, 500)).filter(Boolean).slice(0, 12)
      : [];
    if (!name && excerpts.length === 0) continue;
    out.push({ name: name || "upload", mime, bytes, excerpts });
  }
  return out.length ? out : undefined;
}

export function applyResearchResult(session: ResearchSession, result: ResearchResult): ResearchSession {
  const status: ResearchSessionStatus = result.cancelled
    ? "cancelled"
    : result.ok
      ? "done"
      : "failed";
  return {
    ...session,
    status,
    steps: result.steps ?? session.steps,
    citations: result.citations,
    summary: result.summary ?? "",
    error: result.error,
    partial: result.partial,
    cancelled: result.cancelled,
    report: result.report,
    updatedAt: new Date().toISOString(),
  };
}
