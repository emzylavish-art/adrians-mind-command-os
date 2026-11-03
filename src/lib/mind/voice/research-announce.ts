/**
 * Deep-research lifecycle TTS announcements (one-shot speakText path).
 * Never invents citations or counts. Silent when search is not configured.
 * Not live duplex — status speech only.
 */

import { planDeepQueries, shouldRunDeepResearch, type ResearchResult } from "../research.ts";
import { DEFAULT_VOICE_SETTINGS, loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from "./settings.ts";

export type ResearchAnnouncePhase =
  | "plan_ready"
  | "running"
  | "progress"
  | "complete"
  | "partial"
  | "failed";

export type ResearchAnnounceDecision =
  | { speak: false; reason: "disabled" | "not_deep" | "not_configured" | "empty_query" | "throttled" | "no_utterance" }
  | { speak: true; phase: ResearchAnnouncePhase; text: string };

const PROGRESS_MIN_GAP_MS = 12_000;

/** Pref key folded into VoiceSettings so the Research page can toggle announcements. */
export function researchAnnouncementsEnabled(
  settings: Pick<VoiceSettings, "announceResearch"> | null | undefined,
): boolean {
  if (!settings || typeof settings.announceResearch !== "boolean") {
    return DEFAULT_VOICE_SETTINGS.announceResearch !== false;
  }
  return settings.announceResearch === true;
}

export function readResearchAnnounceEnabled(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
  return researchAnnouncementsEnabled(loadVoiceSettings(storage));
}

export function writeResearchAnnounceEnabled(
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined,
  enabled: boolean,
): VoiceSettings {
  const current = loadVoiceSettings(storage);
  const next = { ...current, announceResearch: enabled };
  saveVoiceSettings(storage, next);
  return next;
}

/** How many planned deep queries (heuristic planner; not sources). */
export function plannedDeepSearchCount(query: string): number {
  const text = query.trim();
  if (!text) return 0;
  return planDeepQueries(text).length;
}

export function isDeepResearchQuery(query: string, deepFlag?: boolean): boolean {
  return shouldRunDeepResearch(query, deepFlag);
}

/** Citation count from actual result data only (never invent). */
export function citationCountFromResult(result: Pick<ResearchResult, "citations"> | null | undefined): number {
  if (!result || !Array.isArray(result.citations)) return 0;
  let n = 0;
  for (const item of result.citations) {
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if (/^https?:\/\//i.test(url)) n += 1;
  }
  return n;
}

export function utteranceForPlanReady(query: string): string | null {
  const n = plannedDeepSearchCount(query);
  if (n < 1) return null;
  return `Deep research plan ready. ${n} search${n === 1 ? "" : "es"} planned. No sources yet.`;
}

export function utteranceForRunning(): string {
  return "Deep research is running. This is status speech, not a live voice conversation.";
}

export function utteranceForProgress(stepIndex: number, stepTotal: number): string | null {
  if (!Number.isFinite(stepIndex) || !Number.isFinite(stepTotal) || stepTotal < 1) return null;
  const i = Math.max(1, Math.min(Math.floor(stepIndex), Math.floor(stepTotal)));
  const t = Math.floor(stepTotal);
  return `Deep research progress: search ${i} of ${t}.`;
}

export function utteranceForComplete(result: Pick<ResearchResult, "ok" | "configured" | "citations" | "partial" | "error">): string | null {
  if (!result.configured) return null; // silent refuse when search isn't configured
  const count = citationCountFromResult(result);
  if (result.ok && result.partial) {
    return `Deep research finished partially with ${count} confirmed citation${count === 1 ? "" : "s"}. Only provider-returned http sources are counted.`;
  }
  if (result.ok) {
    return `Deep research complete. ${count} citation${count === 1 ? "" : "s"} kept.`;
  }
  // Failed but configured: honest failure, still no invented sources
  if (count > 0) {
    return `Deep research failed after keeping ${count} confirmed citation${count === 1 ? "" : "s"}. No sources were invented.`;
  }
  return "Deep research failed. No citations were created.";
}

export type AnnounceResearchEvent =
  | { type: "plan_ready"; query: string }
  | { type: "running"; query: string }
  | { type: "progress"; query: string; stepIndex: number; stepTotal: number; nowMs: number; lastProgressMs: number }
  | { type: "result"; query: string; result: Pick<ResearchResult, "ok" | "configured" | "citations" | "partial" | "error" | "steps"> };

/**
 * Pure mapper: research lifecycle → optional TTS utterance.
 * Callers must not speak when speak=false.
 */
export function decideResearchAnnouncement(
  event: AnnounceResearchEvent,
  opts: { announcementsEnabled: boolean },
): ResearchAnnounceDecision {
  if (!opts.announcementsEnabled) return { speak: false, reason: "disabled" };
  const query = event.query?.trim() ?? "";
  if (!query) return { speak: false, reason: "empty_query" };

  if (event.type === "result") {
    if (!event.result.configured) return { speak: false, reason: "not_configured" };
    // Only announce deep lifecycle completions (steps present or deep query heuristic).
    const deep = Boolean(event.result.steps?.length) || isDeepResearchQuery(query);
    if (!deep) return { speak: false, reason: "not_deep" };
    const text = utteranceForComplete(event.result);
    if (!text) return { speak: false, reason: "no_utterance" };
    const phase: ResearchAnnouncePhase = event.result.ok
      ? event.result.partial
        ? "partial"
        : "complete"
      : "failed";
    return { speak: true, phase, text };
  }

  if (!isDeepResearchQuery(query)) return { speak: false, reason: "not_deep" };

  if (event.type === "plan_ready") {
    const text = utteranceForPlanReady(query);
    if (!text) return { speak: false, reason: "no_utterance" };
    return { speak: true, phase: "plan_ready", text };
  }

  if (event.type === "running") {
    return { speak: true, phase: "running", text: utteranceForRunning() };
  }

  // progress — throttled
  if (event.nowMs - event.lastProgressMs < PROGRESS_MIN_GAP_MS) {
    return { speak: false, reason: "throttled" };
  }
  const text = utteranceForProgress(event.stepIndex, event.stepTotal);
  if (!text) return { speak: false, reason: "no_utterance" };
  return { speak: true, phase: "progress", text };
}

export const RESEARCH_PROGRESS_MIN_GAP_MS = PROGRESS_MIN_GAP_MS;

/**
 * Research mid-run steer is not on voice-integration.
 * BuildSession steer lives on unmerged logic-build-session and is Build-only;
 * LiveVoiceBar binding is Voice Wiring's job.
 */
export type ResearchSteerAvailability =
  | { available: false; reason: string }
  | { available: true; endpoint: string };

export function researchSteerAvailability(input?: {
  hasBuildSessionSteerRoute?: boolean;
  hasResearchSteerRoute?: boolean;
}): ResearchSteerAvailability {
  if (input?.hasResearchSteerRoute) {
    return { available: true, endpoint: "/api/mind/research/steer" };
  }
  return {
    available: false,
    reason:
      "No research steer/interrupt API on this branch. logic-build-session exposes BuildSession /api/mind/build-session/steer (Build only, unmerged). Voice Wiring owns LiveVoiceBar→steer binding. Do not claim live duplex research.",
  };
}
