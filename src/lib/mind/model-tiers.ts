/**
 * Single source of truth: UI model-tier picker → concrete xAI model id + request params.
 * Defaults use model ids verified live against api.x.ai (see xai-verification artifacts).
 * Override any id via env without code changes.
 */

export const MODEL_TIERS = ["Auto", "Fast", "Expert", "Heavy", "Build", "Orchestrator"] as const;
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
  Orchestrator: {
    model: "grok-4.7",
    params: { temperature: 0.2, max_tokens: 1200, reasoning_effort: "high" },
    envKey: "MIND_MODEL_ORCHESTRATOR",
  },
};

export function isModelTier(value: unknown): value is ModelTier {
  return typeof value === "string" && (MODEL_TIERS as readonly string[]).includes(value);
}

export function isConcreteModelTier(value: unknown): value is ConcreteModelTier {
  return isModelTier(value) && value !== "Auto";
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
  Orchestrator: "MIND_MODEL_ORCHESTRATOR",
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
  // After leaving Auto, ignore a prior turn's model unless it matches this concrete tier.
  // Stops "Auto→Fast" residue from looking glued on when Effort/Mode picks Orchestrator etc.
  if (
    input.selected !== "Auto" &&
    input.lastModel &&
    (!input.lastResolved || input.lastResolved === input.selected)
  ) {
    return `${input.selected} · ${input.lastModel}`;
  }
  return input.selected;
}

/** Shared select handler so chip and Mode picker stay one source of truth. */
export function selectModelTier(next: ModelTier): ModelTier {
  return isModelTier(next) ? next : "Auto";
}

const COMPOSER_TIER_BLURB: Record<"Auto" | "Fast" | "Expert" | "Heavy" | "Build", string> = {
  Auto: "",
  Fast: "Quick responses",
  Expert: "Thinks hard",
  Heavy: "Deep reasoning",
  Build: "Build apps and sites",
};

/**
 * Composer model-menu subtitle derived from the tier catalog (client-safe defaults;
 * server env overrides are reported on the chip after a turn). Never hard-code model names.
 */
export function composerTierSubtitle(tier: "Auto" | "Fast" | "Expert" | "Heavy" | "Build"): string {
  if (tier === "Auto") return "Routes to Fast, Expert, Heavy, or Build";
  if (!Object.prototype.hasOwnProperty.call(COMPOSER_TIER_BLURB, tier)) return "";
  return `${COMPOSER_TIER_BLURB[tier]} · ${DEFAULTS[tier].model}`;
}
