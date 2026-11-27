import { environmentModelReadiness, type EnvironmentModelCatalog } from "./environment-model-catalog.ts";
/**
 * Single source of truth: UI model-tier picker → concrete xAI model id + request params.
 * Defaults use model ids verified live against api.x.ai (see xai-verification artifacts).
 * Override any id via env without code changes.
 */

export const MODEL_TIERS = ["Auto", "Fast", "Expert", "Heavy", "Build"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];
/** Chat models returned by the live xAI key. Image and video models stay out of chat. */
export const CONNECTED_GROK_MODELS = ["grok-4.3", "grok-4.5", "grok-4.6", "grok-4.7"] as const;
export function isConnectedGrokModel(value: unknown): value is (typeof CONNECTED_GROK_MODELS)[number] {
  return typeof value === "string" && (CONNECTED_GROK_MODELS as readonly string[]).includes(value);
}
export function isAvailableGrokSelection(value: unknown, env: Record<string, string | undefined> = {}, catalog?: EnvironmentModelCatalog | null): value is string {
  if (typeof value !== "string" || !isValidModelId(value)) return false;
  const readiness = environmentModelReadiness(catalog, value);
  return readiness.ok && (readiness.availability === "catalogued" || allowedModelIds(env).has(value));
}
export type ConcreteModelTier = Exclude<ModelTier, "Auto">;

export type ModelRequestParams = {
  temperature: number;
  max_tokens: number;
  /** xAI reasoning_effort when the model supports it; omitted for non-reasoning Fast/Build. */
  reasoning_effort?: "low" | "medium" | "high" | "xhigh";
};

export type ModelControls = { answerTokens?: number; reasoning?: "auto" | "none" | "low" | "medium" | "high" | "xhigh" };
export const ANSWER_BUDGET_PRESETS = [400, 800, 2048, 4096, 8192] as const;
export const MODEL_CONTROLS_KEY = "amcos.model-controls.v1";
export function loadModelControls(storage: Pick<Storage, "getItem"> | null | undefined): ModelControls {
  try { const raw = storage?.getItem(MODEL_CONTROLS_KEY); const parsed = parseModelControls(raw ? JSON.parse(raw) : null); return parsed.ok ? parsed.controls : {}; }
  catch { return {}; }
}
export function parseModelControls(value: unknown): { ok: true; controls: ModelControls } | { ok: false; error: string } {
  if (value == null) return { ok: true, controls: {} };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Invalid answer controls." };
  const raw = value as Record<string, unknown>;
  if (raw.answerTokens !== undefined && (typeof raw.answerTokens !== "number" || !Number.isInteger(raw.answerTokens) || raw.answerTokens < 128 || raw.answerTokens > 16384)) return { ok: false, error: "Answer budget must be an integer from 128 to 16384 tokens." };
  if (raw.reasoning !== undefined && !["auto", "none", "low", "medium", "high", "xhigh"].includes(String(raw.reasoning))) return { ok: false, error: "Invalid reasoning effort." };
  return { ok: true, controls: { ...(raw.answerTokens === undefined ? {} : { answerTokens: raw.answerTokens as number }), ...(raw.reasoning === undefined ? {} : { reasoning: raw.reasoning as ModelControls["reasoning"] }) } };
}

export function supportsTierReasoning(model: string): boolean {
  return ["grok-4.5", "grok-4.6", "grok-4.7"].includes(model);
}
export function reconcileTierParams(model: string, params: ModelRequestParams): ModelRequestParams {
  const result = { ...params };
  if (!supportsTierReasoning(model)) delete result.reasoning_effort;
  return result;
}

export type ResolvedModelTier = {
  /** Tier the owner selected in the UI (may be Auto). */
  selected: ModelTier;
  /** Concrete tier after Auto routing (never Auto). */
  resolved: ConcreteModelTier;
  model: string;
  params: ModelRequestParams;
  reason: string;
};

const DEFAULTS: Record<ConcreteModelTier, { model: string; params: ModelRequestParams; envKey: string }> = {
  Fast: {
    model: "grok-4.20-0309-non-reasoning",
    params: { temperature: 0.3, max_tokens: 400 },
    envKey: "MIND_MODEL_FAST",
  },
  Expert: {
    model: "grok-4.5",
    params: { temperature: 0.4, max_tokens: 500, reasoning_effort: "medium" },
    envKey: "MIND_MODEL_EXPERT",
  },
  Heavy: {
    model: "grok-4.7",
    params: { temperature: 0.2, max_tokens: 800, reasoning_effort: "high" },
    envKey: "MIND_MODEL_HEAVY",
  },
  Build: {
    model: "grok-build-0.1",
    params: { temperature: 0.2, max_tokens: 700 },
    envKey: "MIND_MODEL_BUILD",
  },
};

export function isModelTier(value: unknown): value is ModelTier {
  return typeof value === "string" && (MODEL_TIERS as readonly string[]).includes(value);
}

/** Max accepted length for a MIND_MODEL_* override (never echo the raw value in issues). */
export const MAX_MODEL_ID_LENGTH = 128;

/**
 * Allowed model id shape: starts with alnum; then alnum / . _ : / -
 * Rejects whitespace, control chars, and API-key-shaped values (xai-/sk-/Bearer…).
 */
export function isValidModelId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_MODEL_ID_LENGTH) return false;
  if (/\s/.test(trimmed)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  if (/^(xai-|sk-|Bearer\b)/i.test(trimmed)) return false;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(trimmed)) return false;
  return true;
}

function readModelOverride(
  raw: string | undefined,
  fallback: string,
): { model: string; issue: string | null } {
  if (raw === undefined) return { model: fallback, issue: null };
  // Empty / whitespace-only counts as an explicit bad override when the key is present.
  if (!raw.trim()) {
    return { model: fallback, issue: "ignored (empty or whitespace)" };
  }
  if (!isValidModelId(raw)) {
    return { model: fallback, issue: "ignored (invalid or secret-shaped); using default" };
  }
  return { model: raw.trim(), issue: null };
}

const ENV_KEYS: Record<ConcreteModelTier, string> = {
  Fast: "MIND_MODEL_FAST",
  Expert: "MIND_MODEL_EXPERT",
  Heavy: "MIND_MODEL_HEAVY",
  Build: "MIND_MODEL_BUILD",
};

export function parseModelTierEnv(env: Record<string, string | undefined> = {}): Record<ConcreteModelTier, string> {
  const out = {} as Record<ConcreteModelTier, string>;
  for (const tier of Object.keys(ENV_KEYS) as ConcreteModelTier[]) {
    const key = ENV_KEYS[tier];
    out[tier] = readModelOverride(env[key], DEFAULTS[tier].model).model;
  }
  return out;
}

/** Warnings for bad MIND_MODEL_* values — never echoes the raw value (may be a secret). */
export function modelTierEnvIssues(env: Record<string, string | undefined> = {}): string[] {
  const issues: string[] = [];
  for (const tier of Object.keys(ENV_KEYS) as ConcreteModelTier[]) {
    const key = ENV_KEYS[tier];
    if (!Object.prototype.hasOwnProperty.call(env, key)) continue;
    const read = readModelOverride(env[key], DEFAULTS[tier].model);
    if (read.issue) issues.push(`${key} ${read.issue}`);
  }
  return issues;
}

export function defaultParamsFor(tier: ConcreteModelTier): ModelRequestParams {
  return { ...DEFAULTS[tier].params };
}

/**
 * Auto routing rules (order matters):
 * 1) Code-shaped prompts → Build (fences, languages, refactor/PR/stack-trace cues).
 * 2) Heavy only for deep-reasoning signals OR length ≥ 1800.
 *    Deep signals: prove/derive/theorem/formal proof/rigorous/multi-step/
 *    deep analysis/compare and contrast — NOT everyday words like tradeoffs,
 *    architecture, or design (those stay Expert when medium-length).
 * 3) Medium analytical (length ≥ 320 or explain/analyze/design/plan/…) → Expert.
 * 4) Otherwise → Fast.
 */
export function routeAutoTier(prompt: string, previousTier?: ConcreteModelTier): { tier: ConcreteModelTier; reason: string } {
  const text = prompt.trim();
  if (previousTier && /^(?:next(?: analysis)?|continue(?: please)?|go on|keep going|carry on|finish(?: it)?|do the same|again)[.!?\s]*$/i.test(text)) {
    return { tier: previousTier, reason: `Auto retained ${previousTier} for an explicit continuation of this conversation.` };
  }
  const lower = text.toLowerCase();
  const length = text.length;
  const hasCode =
    /```/.test(text) ||
    /\b(function|const|let|class|import|export|def |fn |docker|kubernetes|typescript|javascript|python|refactor|pull request|unit test|stack trace)\b/i.test(
      text,
    ) ||
    /\.(ts|tsx|js|jsx|py|go|rs|java|cpp|c|h)(\b|:)/i.test(text);
  if (hasCode) {
    return { tier: "Build", reason: "Auto routed to Build because the prompt looks code-oriented." };
  }
  // Narrow: exclude trade-offs/architecture so medium analytical prompts stay Expert.
  const deepReasoning =
    /\b(prove|derive|theorem|multi[- ]?step|deep analysis|rigorous|formal proof|compare and contrast)\b/i.test(lower);
  if (length >= 1800 || deepReasoning) {
    return { tier: "Heavy", reason: "Auto routed to Heavy because the prompt is long or asks for deep reasoning." };
  }
  if (
    length >= 320 ||
    /\b(explain|analyze|analyse|summarize|summarise|design|plan|why|how does|compare|trade-?offs?|architect(?:ure|ural)?)\b/i.test(
      lower,
    )
  ) {
    return { tier: "Expert", reason: "Auto routed to Expert for a medium-complexity prompt." };
  }
  return { tier: "Fast", reason: "Auto routed to Fast for a short, simple prompt." };
}

export function resolveModelTier(
  selectedRaw: unknown,
  prompt: string,
  env: Record<string, string | undefined> = {},
  options: { previousTier?: ConcreteModelTier; controls?: ModelControls } = {},
): ResolvedModelTier {
  const selected: ModelTier = isModelTier(selectedRaw) ? selectedRaw : "Auto";
  const models = parseModelTierEnv(env);
  let resolved: ConcreteModelTier;
  let reason: string;
  if (selected === "Auto") {
    const routed = routeAutoTier(prompt, options.previousTier);
    resolved = routed.tier;
    reason = routed.reason;
  } else {
    resolved = selected;
    reason = `Owner selected ${selected}.`;
  }
  const params = defaultParamsFor(resolved);
  if (options.controls?.answerTokens !== undefined && parseModelControls(options.controls).ok) params.max_tokens = options.controls.answerTokens;
  // An arbitrary environment model override cannot inherit another model's reasoning parameters.
  if (!supportsTierReasoning(models[resolved]) || options.controls?.reasoning === "none") delete params.reasoning_effort;
  else if (options.controls?.reasoning && options.controls.reasoning !== "auto") params.reasoning_effort = options.controls.reasoning;
  return {
    selected,
    resolved,
    model: models[resolved],
    params,
    reason,
  };
}

/** Build the JSON body fields that go to xAI chat completions for a resolved tier. */
export function buildProviderModelFields(resolved: Pick<ResolvedModelTier, "model" | "params">): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: resolved.model,
    temperature: resolved.params.temperature,
    max_tokens: resolved.params.max_tokens,
  };
  if (resolved.params.reasoning_effort) {
    body.reasoning_effort = resolved.params.reasoning_effort;
  }
  return body;
}

export function configuredModelReadiness(model: string, observedCatalog?: readonly string[] | EnvironmentModelCatalog) {
  if (observedCatalog && !Array.isArray(observedCatalog)) {
    const readiness = environmentModelReadiness(observedCatalog as EnvironmentModelCatalog, model);
    return { verifiedInference: false as const, availability: readiness.availability };
  }
  const listed = observedCatalog as readonly string[] | undefined;
  return { verifiedInference: false as const, availability: listed === undefined ? "unverified" as const : listed.includes(model) ? "catalogued" as const : "unavailable" as const };
}

export function modelTierCatalog(env: Record<string, string | undefined> = {}, observedCatalog?: readonly string[] | EnvironmentModelCatalog) {
  const models = parseModelTierEnv(env);
  const readiness = Object.values(models).map(model => configuredModelReadiness(model, observedCatalog).availability);
  const autoAvailability = readiness.includes("catalogued") ? "catalogued" as const : readiness.includes("unverified") ? "unverified" as const : readiness.includes("stale") ? "stale" as const : readiness.includes("unconfigured") ? "unconfigured" as const : "unavailable" as const;
  return MODEL_TIERS.map((tier) => {
    if (tier === "Auto") {
      return {
        id: tier,
        label: tier,
        model: null as string | null,
        note: `Routes using this request and its prior confirmed tier. The resolved model is checked against the current catalogue; it never switches to an available alternative. Catalogue state: ${autoAvailability}.`,
        verifiedInference: false as const,
        availability: autoAvailability,
      };
    }
    return {
      id: tier,
      label: tier,
      model: models[tier],
      ...configuredModelReadiness(models[tier], observedCatalog),
      note: `Configured to request ${models[tier]} (${DEFAULTS[tier].envKey}). ${configuredModelReadiness(models[tier], observedCatalog).availability === "catalogued" ? "Listed in the observed catalogue; inference has not been verified." : observedCatalog ? "The selected model is not currently confirmed available; refresh its catalogue or choose another model explicitly." : "Current account availability and inference are unverified."}`,
    };
  });
}
export type ModelTierCatalogRow = ReturnType<typeof modelTierCatalog>[number];

/** Known allowed model ids for this app (defaults + any env override values). */
export function allowedModelIds(env: Record<string, string | undefined> = {}): Set<string> {
  const models = parseModelTierEnv(env);
  return new Set([...Object.values(models), ...CONNECTED_GROK_MODELS]);
}


/** Header chip / picker label: selected tier, plus Auto→resolved after a turn. */
export function chipLabelForTier(input: {
  selected: ModelTier;
  lastResolved?: ConcreteModelTier | null;
  lastModel?: string | null;
}): string {
  if (input.selected === "Auto" && input.lastResolved) {
    const modelBit = input.lastModel ? ` · ${input.lastModel}` : "";
    return `Auto→${input.lastResolved}${modelBit}`;
  }
  if (input.lastModel && input.selected !== "Auto") {
    return `${input.selected} · ${input.lastModel}`;
  }
  return input.selected;
}

/** Shared select handler so chip and Mode picker stay one source of truth. */
export function selectModelTier(next: ModelTier): ModelTier {
  return isModelTier(next) ? next : "Auto";
}
