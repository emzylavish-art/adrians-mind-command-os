/**
 * Single source of truth: UI model-tier picker → concrete xAI model id + request params.
 * Defaults use model ids verified live against api.x.ai (see xai-verification artifacts).
 * Override any id via env without code changes.
 */

export const MODEL_TIERS = ["Auto", "Fast", "Expert", "Heavy", "Build"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];
export type ConcreteModelTier = Exclude<ModelTier, "Auto">;

export type ModelRequestParams = {
  temperature: number;
  max_tokens: number;
  /** xAI reasoning_effort when the model supports it; omitted for non-reasoning Fast/Build. */
  reasoning_effort?: "low" | "medium" | "high" | "xhigh";
};

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

export function parseModelTierEnv(env: Record<string, string | undefined> = {}): Record<ConcreteModelTier, string> {
  return {
    Fast: env.MIND_MODEL_FAST?.trim() || DEFAULTS.Fast.model,
    Expert: env.MIND_MODEL_EXPERT?.trim() || DEFAULTS.Expert.model,
    Heavy: env.MIND_MODEL_HEAVY?.trim() || DEFAULTS.Heavy.model,
    Build: env.MIND_MODEL_BUILD?.trim() || DEFAULTS.Build.model,
  };
}

export function defaultParamsFor(tier: ConcreteModelTier): ModelRequestParams {
  return { ...DEFAULTS[tier].params };
}

/**
 * Auto routing: code-shaped prompts → Build; long/complex reasoning → Heavy;
 * medium analytical → Expert; short/simple → Fast.
 */
export function routeAutoTier(prompt: string): { tier: ConcreteModelTier; reason: string } {
  const text = prompt.trim();
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
  const heavyHints =
    /\b(prove|derive|theorem|multi[- ]?step|trade-?offs?|architect(?:ure|ural)?|deep analysis|rigorous|formal proof|compare and contrast)\b/i.test(
      lower,
    );
  if (length >= 1800 || heavyHints) {
    return { tier: "Heavy", reason: "Auto routed to Heavy because the prompt is long or asks for deep reasoning." };
  }
  if (
    length >= 320 ||
    /\b(explain|analyze|analyse|summarize|summarise|design|plan|why|how does|compare)\b/i.test(lower)
  ) {
    return { tier: "Expert", reason: "Auto routed to Expert for a medium-complexity prompt." };
  }
  return { tier: "Fast", reason: "Auto routed to Fast for a short, simple prompt." };
}

export function resolveModelTier(
  selectedRaw: unknown,
  prompt: string,
  env: Record<string, string | undefined> = {},
): ResolvedModelTier {
  const selected: ModelTier = isModelTier(selectedRaw) ? selectedRaw : "Auto";
  const models = parseModelTierEnv(env);
  let resolved: ConcreteModelTier;
  let reason: string;
  if (selected === "Auto") {
    const routed = routeAutoTier(prompt);
    resolved = routed.tier;
    reason = routed.reason;
  } else {
    resolved = selected;
    reason = `Owner selected ${selected}.`;
  }
  return {
    selected,
    resolved,
    model: models[resolved],
    params: defaultParamsFor(resolved),
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

export function modelTierCatalog(env: Record<string, string | undefined> = {}) {
  const models = parseModelTierEnv(env);
  return MODEL_TIERS.map((tier) => {
    if (tier === "Auto") {
      return {
        id: tier,
        label: tier,
        model: null as string | null,
        note: "Routes to Fast, Expert, Heavy, or Build from prompt shape.",
      };
    }
    return {
      id: tier,
      label: tier,
      model: models[tier],
      note: `Uses ${models[tier]} (${DEFAULTS[tier].envKey}).`,
    };
  });
}

/** Known allowed model ids for this app (defaults + any env override values). */
export function allowedModelIds(env: Record<string, string | undefined> = {}): Set<string> {
  const models = parseModelTierEnv(env);
  return new Set(Object.values(models));
}
