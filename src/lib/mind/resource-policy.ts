/** Financial limits use integer USD millionths. Unknown cost is never zero. */
export type ResourcePrice = { revision: string; inputUsdMicrosPerMillion: number; outputUsdMicrosPerMillion: number };
export type ResourcePolicy = {
  freeOnly: boolean;
  maxCallsPerDay: number;
  maxConcurrent: number;
  maxTokensPerDay: number | null;
  maxDailyUsdMicros: number | null;
  maxCallUsdMicros: number | null;
  allowUnknownCost: boolean;
  prices: Record<string, ResourcePrice>;
};
export const DEFAULT_RESOURCE_POLICY: ResourcePolicy = { freeOnly: false, maxCallsPerDay: 1000, maxConcurrent: 4, maxTokensPerDay: null, maxDailyUsdMicros: null, maxCallUsdMicros: null, allowUnknownCost: true, prices: {} };
export function readResourcePolicy(value: unknown): ResourcePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid resource policy.");
  const row = value as Record<string, unknown>;
  const integer = (key: string, min: number, max: number, nullable = false): number | null => {
    const v = row[key];
    if (nullable && v === null) return null;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) throw new Error(`Invalid ${key}.`);
    return v;
  };
  if (typeof row.freeOnly !== "boolean" || typeof row.allowUnknownCost !== "boolean") throw new Error("Choose an explicit spending policy.");
  const prices: Record<string, ResourcePrice> = {};
  if (!row.prices || typeof row.prices !== "object" || Array.isArray(row.prices) || Object.keys(row.prices).length > 100) throw new Error("Invalid pricing table.");
  for (const [key, value] of Object.entries(row.prices)) {
    if (!/^[A-Za-z0-9_:./@-]{1,240}$/.test(key) || !value || typeof value !== "object") throw new Error("Invalid pricing entry.");
    const p = value as ResourcePrice;
    if (typeof p.revision !== "string" || !p.revision.trim() || p.revision.length > 120 || ![p.inputUsdMicrosPerMillion, p.outputUsdMicrosPerMillion].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000_000)) throw new Error("Invalid versioned provider price.");
    prices[key] = { ...p };
  }
  return { freeOnly: row.freeOnly, allowUnknownCost: row.allowUnknownCost, maxCallsPerDay: integer("maxCallsPerDay", 1, 100000)!, maxConcurrent: integer("maxConcurrent", 1, 20)!, maxTokensPerDay: integer("maxTokensPerDay", 1, 1_000_000_000, true), maxDailyUsdMicros: integer("maxDailyUsdMicros", 0, 1_000_000_000_000, true), maxCallUsdMicros: integer("maxCallUsdMicros", 0, 1_000_000_000_000, true), prices };
}
export function resourceEstimate(price: ResourcePrice | undefined, inputTokens: number, outputTokens: number): number | null {
  if (!price || ![inputTokens, outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  const n = Math.ceil(inputTokens * price.inputUsdMicrosPerMillion / 1_000_000 + outputTokens * price.outputUsdMicrosPerMillion / 1_000_000);
  return Number.isSafeInteger(n) ? n : null;
}
export function resourcePlanAllowed(input: { policy: ResourcePolicy; free: boolean; estimate: number | null; calls: number; active: number; tokens: number; committed: number }): string | null {
  const { policy, estimate } = input;
  if (policy.freeOnly && !input.free) return "Account Free-only policy blocks this route.";
  if (input.calls >= policy.maxCallsPerDay) return "Daily provider-call limit reached.";
  if (input.active >= policy.maxConcurrent) return "Provider concurrency limit reached. Wait for current operations.";
  if (policy.maxTokensPerDay !== null && input.tokens >= policy.maxTokensPerDay) return "Daily token allowance reached.";
  if (!input.free && estimate === null && (!policy.allowUnknownCost || policy.maxDailyUsdMicros !== null || policy.maxCallUsdMicros !== null)) return "Provider cost is unknown. This spending policy requires a versioned price before dispatch.";
  if (estimate !== null && policy.maxCallUsdMicros !== null && estimate > policy.maxCallUsdMicros) return "Estimated request cost exceeds the per-call allowance.";
  if (estimate !== null && policy.maxDailyUsdMicros !== null && input.committed + estimate > policy.maxDailyUsdMicros) return "Insufficient unreserved daily allowance.";
  return null;
}


/** A provider label alone does not prove that its configured endpoint is free. */
export function isAutomaticallyFreeModelRoute(provider: string, model: string, localEndpoint?: string): boolean {
  if ((provider === "openrouter" || provider === "nemotron") && model.endsWith(":free")) return true;
  if (provider !== "ollama" || !localEndpoint || /(?:^|[:/-])cloud(?:$|[:/-])/i.test(model)) return false;
  try {
    const url = new URL(localEndpoint);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  } catch { return false; }
}
