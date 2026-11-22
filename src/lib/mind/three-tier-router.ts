/**
 * Three-tier always-on agent router for Adrian's Mind OS.
 *
 * Tier 1 — ~300 MB always-resident local classifier (never long generation).
 * Tier 2 — ~7B 4-bit worker, load-on-demand, hard idle unload (default 30s).
 * Tier 3 — cloud via OpenAI-compatible Key Proxy / configured providers.
 *
 * Mind OS base must never preload Tier 2 at startup.
 */

export type AgentTier = 1 | 2 | 3;

export type TierRouteInput = {
  text: string;
  /** Optional explicit owner override. */
  forceTier?: AgentTier;
  /** Classifier confidence 0..1 from Tier 1. */
  confidence?: number;
  /** Prior Tier 2 failure or uncertainty flag. */
  tier2Uncertain?: boolean;
  /** Simple intent label from Tier 1. */
  intent?: string;
};

export type TierRouteDecision = {
  tier: AgentTier;
  reason: string;
  confidence: number;
  intent: string;
  /** Whether Tier 2 should be loaded for this decision. */
  loadTier2: boolean;
  /** Never true at process boot — startup must keep Tier 2 cold. */
  preloadTier2AtStartup: false;
};

export type TierTaskRecord = {
  id: string;
  at: string;
  tier: AgentTier;
  intent: string;
  latencyMs: number;
  accepted: boolean | null;
  useful: boolean | null;
  promptChars: number;
  responseChars: number;
  notes?: string;
};

/** Intents Tier 1 is allowed to finish alone (no long generation). */
export const TIER1_ONLY_INTENTS = new Set([
  "wake_word",
  "heartbeat",
  "log_event",
  "intent_classify",
  "route_decide",
  "health",
]);

/** Intents that should go straight to cloud brain. */
export const TIER3_INTENTS = new Set([
  "architecture",
  "multi_step_debug",
  "long_context",
  "complex_debug",
  "agentic",
]);

/** Default confidence gate: below this, escalate Tier 1 → Tier 2. */
export const TIER1_CONFIDENCE_GATE = 0.8;

/** Hard idle unload for Tier 2 (owner instruction: 30 seconds). */
export const TIER2_IDLE_UNLOAD_MS = 30_000;

/** Soft TTL if configured longer; hard unload still uses TIER2_IDLE_UNLOAD_MS. */
export const TIER2_SOFT_TTL_MS = 10 * 60_000;

export function classifyIntentHeuristic(text: string): { intent: string; confidence: number } {
  const t = text.trim().toLowerCase();
  if (!t) return { intent: "heartbeat", confidence: 1 };
  if (/^(ping|health|heartbeat|status)\b/.test(t)) return { intent: "heartbeat", confidence: 0.95 };
  if (/^(hey|wake|adrian|listen)\b/.test(t)) return { intent: "wake_word", confidence: 0.9 };
  if (/architect|redesign system|multi-?step|long context|refactor entire/.test(t)) {
    return { intent: "architecture", confidence: 0.85 };
  }
  if (/error log|stack trace|build failed|summarize (the )?build|fix this error/.test(t)) {
    return { intent: "log_triage", confidence: 0.82 };
  }
  if (/^(hi|hello|hey|thanks|ok)\b/.test(t) && t.length < 40) {
    return { intent: "simple_chat", confidence: 0.88 };
  }
  if (t.length < 120) return { intent: "routine_tool", confidence: 0.75 };
  return { intent: "general", confidence: 0.7 };
}

export function routeTier(input: TierRouteInput): TierRouteDecision {
  if (input.forceTier === 1 || input.forceTier === 2 || input.forceTier === 3) {
    return {
      tier: input.forceTier,
      reason: `owner force tier ${input.forceTier}`,
      confidence: input.confidence ?? 1,
      intent: input.intent || "forced",
      loadTier2: input.forceTier === 2,
      preloadTier2AtStartup: false,
    };
  }

  const classified =
    input.intent && input.confidence != null
      ? { intent: input.intent, confidence: input.confidence }
      : classifyIntentHeuristic(input.text);

  if (TIER1_ONLY_INTENTS.has(classified.intent) && classified.confidence >= TIER1_CONFIDENCE_GATE) {
    return {
      tier: 1,
      reason: "tier1-only intent with confidence gate",
      confidence: classified.confidence,
      intent: classified.intent,
      loadTier2: false,
      preloadTier2AtStartup: false,
    };
  }

  if (TIER3_INTENTS.has(classified.intent) || input.tier2Uncertain) {
    return {
      tier: 3,
      reason: input.tier2Uncertain ? "tier2 uncertain or failed" : "complex intent → cloud brain",
      confidence: classified.confidence,
      intent: classified.intent,
      loadTier2: false,
      preloadTier2AtStartup: false,
    };
  }

  if (classified.confidence < TIER1_CONFIDENCE_GATE) {
    return {
      tier: 2,
      reason: `tier1 confidence ${classified.confidence} < ${TIER1_CONFIDENCE_GATE}`,
      confidence: classified.confidence,
      intent: classified.intent,
      loadTier2: true,
      preloadTier2AtStartup: false,
    };
  }

  // Default ~80% worker path
  return {
    tier: 2,
    reason: "default worker tier for routine work",
    confidence: classified.confidence,
    intent: classified.intent,
    loadTier2: true,
    preloadTier2AtStartup: false,
  };
}

export type Tier2LoadState = {
  loaded: boolean;
  lastUsedAt: number | null;
  /** Never load at startup. */
  loadedAtStartup: false;
};

export function createColdTier2State(): Tier2LoadState {
  return { loaded: false, lastUsedAt: null, loadedAtStartup: false };
}

export function touchTier2(state: Tier2LoadState, now = Date.now()): Tier2LoadState {
  return { ...state, loaded: true, lastUsedAt: now, loadedAtStartup: false };
}

export function shouldUnloadTier2(state: Tier2LoadState, now = Date.now(), idleMs = TIER2_IDLE_UNLOAD_MS): boolean {
  if (!state.loaded || state.lastUsedAt == null) return false;
  return now - state.lastUsedAt >= idleMs;
}

export function unloadTier2IfIdle(state: Tier2LoadState, now = Date.now(), idleMs = TIER2_IDLE_UNLOAD_MS): Tier2LoadState {
  if (shouldUnloadTier2(state, now, idleMs)) {
    return { loaded: false, lastUsedAt: null, loadedAtStartup: false };
  }
  return state;
}

export function formatDailyCommandLogLine(record: TierTaskRecord): string {
  const acc = record.accepted === null ? "pending" : record.accepted ? "accepted" : "rejected";
  const useful = record.useful === null ? "n/a" : record.useful ? "useful" : "not-useful";
  return [
    record.at,
    `tier=${record.tier}`,
    `intent=${record.intent}`,
    `latency_ms=${record.latencyMs}`,
    `accepted=${acc}`,
    `useful=${useful}`,
    `prompt_chars=${record.promptChars}`,
    `response_chars=${record.responseChars}`,
    record.notes ? `notes=${record.notes.replace(/\s+/g, " ").slice(0, 120)}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}
