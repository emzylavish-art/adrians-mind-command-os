/**
 * Chat model-picker selections for Astra, Sol, and Luna.
 * Readiness and the live call stay in the provider adapter. This module only
 * names the selection, the payload, and the honest not-ready copy.
 */

import type { ModelTier } from "./model-tiers.ts";

export const LOGIC_ROUTES = ["astra", "sol", "luna"] as const;
export type LogicRouteId = (typeof LOGIC_ROUTES)[number];

export const LOGIC_ROUTE_STORAGE_KEY = "amcos.logicRoute.v1";
export const PROVIDER_STORAGE_KEY = "amcos.provider.v1";
export const MODEL_TIER_STORAGE_KEY = "amcos.modelTier.v1";

/** Env names the worker provider.status contract reads. Not a stand-in for readiness. */
export const LOGIC_ROUTE_ENV: Record<LogicRouteId, { key: string; model: string; base: string }> = {
  astra: { key: "ASTRA_API_KEY", model: "ASTRA_MODEL", base: "ASTRA_API_BASE_URL" },
  sol: { key: "SOL_API_KEY", model: "SOL_MODEL", base: "SOL_API_BASE_URL" },
  luna: { key: "LUNA_API_KEY", model: "LUNA_MODEL", base: "LUNA_API_BASE_URL" },
};

export type RouteState = "configured" | "authenticated" | "needs-config" | "blocked";

export const LOGIC_ROUTE_LABEL: Record<LogicRouteId, "Astra" | "Sol" | "Luna"> = {
  astra: "Astra",
  sol: "Sol",
  luna: "Luna",
};

/** What the picker and status endpoint may show. No endpoint URL and no secrets. */
export type LogicRoutePublic = {
  id: LogicRouteId;
  label: "Astra" | "Sol" | "Luna";
  state: RouteState;
  /** True only for configured or authenticated. Needs-config and blocked cannot send. */
  ready: boolean;
  model: string | null;
  /** Exact env var names that are still unset for this route. */
  missing: string[];
  reason: string;
  /** Env var name provider.status reported, such as SOL_API_KEY or OPENAI_API_KEY. */
  credential: string | null;
  /** Set when the adapter used OPENAI_API_KEY instead of the route key. Never a secret. */
  credentialFallback: "OPENAI_API_KEY" | null;
};

/** One provider row from worker publicStatus / provider.status. No key material. */
export type ProviderStatusRoute = {
  id: string;
  configured: boolean;
  model: string | null;
  endpoint: string | null;
  credential: string;
};

export type ProviderStatusSnapshot = {
  live_verified?: boolean;
  app_budget?: { paused?: boolean; accounting?: string };
  providers?: ProviderStatusRoute[];
};

export type LogicRouteInspection = LogicRoutePublic & {
  /** Adapter endpoint. Server-only. Never send this to the browser. */
  endpoint: string | null;
};

export type AdapterMessage = { role: "system" | "user" | "assistant"; content: string };

export function isLogicRouteId(value: unknown): value is LogicRouteId {
  return value === "astra" || value === "sol" || value === "luna";
}

export function readStoredLogicRoute(raw: string | null): LogicRouteId | null {
  return isLogicRouteId(raw) ? raw : null;
}

/** Missing, null, or "" means the Grok tier picker. Anything else must be exact. */
export function parseLogicRouteField(value: unknown): { ok: true; route: LogicRouteId | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, route: null };
  if (!isLogicRouteId(value)) {
    return { ok: false, error: "Unknown model route. Choose Astra, Sol, or Luna. Another route was not substituted." };
  }
  return { ok: true, route: value };
}

export function logicRoutesUnavailable(reason: string): LogicRouteInspection[] {
  return LOGIC_ROUTES.map((id) => ({
    id,
    label: LOGIC_ROUTE_LABEL[id],
    state: "blocked" as const,
    ready: false,
    model: null,
    endpoint: null,
    missing: [],
    reason,
    credential: null,
    credentialFallback: null,
  }));
}

function pushMissing(missing: string[], name: string) {
  if (!missing.includes(name)) missing.push(name);
}

/**
 * Map a provider.status snapshot onto picker state.
 * A missing row is a probe failure, not a claim that the route was never built.
 * Defaults such as gpt-6-sol stay whatever the snapshot reports.
 */
export function readinessFromProviderStatus(snapshot: ProviderStatusSnapshot): LogicRouteInspection[] {
  const paused = snapshot.app_budget?.paused === true;
  const accounting = snapshot.app_budget?.accounting;
  const live = snapshot.live_verified === true;
  return LOGIC_ROUTES.map((id) => {
    const label = LOGIC_ROUTE_LABEL[id];
    const env = LOGIC_ROUTE_ENV[id];
    const row = snapshot.providers?.find((item) => item.id === id);
    if (!row) {
      return {
        id,
        label,
        state: "blocked" as const,
        ready: false,
        model: null,
        endpoint: null,
        missing: [],
        credential: null,
        credentialFallback: null,
        reason: `${label} readiness could not be read from provider.status. Nothing was sent.`,
      };
    }
    const model = typeof row.model === "string" && row.model.trim() ? row.model.trim() : null;
    const endpoint = typeof row.endpoint === "string" && row.endpoint.trim() ? row.endpoint.trim() : null;
    const credential = typeof row.credential === "string" ? row.credential : "unset";
    const credentialFallback = credential === "OPENAI_API_KEY" ? ("OPENAI_API_KEY" as const) : null;
    const missing: string[] = [];
    if (!row.configured) {
      if (credential === "unset" || !credential) {
        pushMissing(missing, env.key);
        pushMissing(missing, "OPENAI_API_KEY");
      }
      if (!endpoint) pushMissing(missing, env.base);
      if (!model) pushMissing(missing, env.model);
    }
    let state: RouteState;
    let reason: string;
    if (paused) {
      state = "blocked";
      reason =
        accounting === "invalid"
          ? `${label} is blocked. Budget values are invalid. Nothing was sent.`
          : `${label} is blocked. App budget cap is exhausted. Nothing was sent.`;
    } else if (!row.configured) {
      state = "needs-config";
      const named = missing.length ? missing.join(", ") : `${env.key}, ${env.model}, ${env.base}`;
      reason = `${label} needs config. Missing ${named}. Nothing was sent.`;
    } else if (live) {
      state = "authenticated";
      reason = `${label} is authenticated. The next send uses ${model ?? "the configured model"}.`;
    } else {
      state = "configured";
      const fallback = credentialFallback ? ` Credential fallback: ${credentialFallback} is set and ${env.key} is not. This is not a live authentication.` : " provider.status did not make a live call, so this is not authenticated.";
      reason = `${label} is configured. The next send uses ${model ?? "the configured model"}.${fallback}`;
    }
    const ready = state === "configured" || state === "authenticated";
    return {
      id,
      label,
      state,
      ready,
      model: model,
      endpoint,
      missing,
      reason,
      credential: credential === "unset" ? null : credential,
      credentialFallback,
    };
  });
}

export type StoredSelection = {
  provider: string;
  modelTier: ModelTier;
  logicRoute: LogicRouteId | null;
};

const STORED_PROVIDERS = new Set(["grok", "openai", "anthropic", "gemini", "openrouter", "ollama", "astra", "sol", "luna"]);

export function readStoredProvider(raw: string | null): string {
  return raw && STORED_PROVIDERS.has(raw) ? raw : "grok";
}

export function readSelection(storage: Pick<Storage, "getItem"> | null | undefined): StoredSelection {
  let provider = "grok";
  let modelTier: ModelTier = "Auto";
  let logicRoute: LogicRouteId | null = null;
  try {
    provider = readStoredProvider(storage?.getItem(PROVIDER_STORAGE_KEY) ?? null);
    const tier = storage?.getItem(MODEL_TIER_STORAGE_KEY);
    if (tier === "Auto" || tier === "Fast" || tier === "Expert" || tier === "Heavy" || tier === "Build") modelTier = tier;
    logicRoute = readStoredLogicRoute(storage?.getItem(LOGIC_ROUTE_STORAGE_KEY) ?? null);
  } catch {
    /* private mode */
  }
  return { provider, modelTier, logicRoute };
}

export function writeSelection(storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined, selection: StoredSelection): void {
  if (!storage) return;
  try {
    storage.setItem(PROVIDER_STORAGE_KEY, readStoredProvider(selection.provider));
    storage.setItem(MODEL_TIER_STORAGE_KEY, selection.modelTier);
    if (selection.logicRoute) storage.setItem(LOGIC_ROUTE_STORAGE_KEY, selection.logicRoute);
    else storage.removeItem(LOGIC_ROUTE_STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

/** logicRoute wins only when provider agrees or is empty. A mismatch is refused. */
export function resolveRequestedRoute(input: { logicRoute: unknown; provider: unknown }): { ok: true; route: LogicRouteId | null } | { ok: false; error: string } {
  const parsed = parseLogicRouteField(input.logicRoute);
  if (!parsed.ok) return parsed;
  const providerIsRoute = isLogicRouteId(input.provider);
  if (parsed.route && providerIsRoute && parsed.route !== input.provider) {
    return {
      ok: false,
      error: `Selection conflict: logicRoute is ${parsed.route} and provider is ${input.provider}. Nothing was sent. Another route was not substituted.`,
    };
  }
  if (parsed.route) return { ok: true, route: parsed.route };
  if (providerIsRoute) return { ok: true, route: input.provider };
  return { ok: true, route: null };
}

/** model.generate arguments. Matches the worker schema: provider plus messages, never a bare {text}. */
export type ModelGenerateArgs = {
  provider: LogicRouteId;
  messages: AdapterMessage[];
  model?: string;
  stream: false;
  timeout_seconds: number;
};

export function modelGenerateArgs(route: LogicRouteId, messages: AdapterMessage[], model: string | null, timeoutSec = 20): ModelGenerateArgs {
  const args: ModelGenerateArgs = { provider: route, messages, stream: false, timeout_seconds: timeoutSec };
  if (model && model.trim()) args.model = model.trim();
  return args;
}

export function respondedRouteLabel(input: {
  provider?: string | null;
  model?: string | null;
  requestedModel?: string | null;
  credentialFallback?: string | null;
}): string {
  const provider = input.provider?.trim() || "unknown provider";
  const model = input.model?.trim() || "unknown model";
  let text = `Responded ${provider} · ${model}.`;
  if (input.requestedModel && input.model && input.requestedModel !== input.model) {
    text += ` Requested ${input.requestedModel}; the adapter responded with ${input.model}.`;
  }
  if (input.credentialFallback) text += ` Credential fallback: ${input.credentialFallback}.`;
  return text;
}

export function toPublicLogicRoute(row: LogicRouteInspection): LogicRoutePublic {
  return {
    id: row.id,
    label: row.label,
    state: row.state,
    ready: row.ready,
    model: row.model,
    missing: row.missing,
    reason: row.reason,
    credential: row.credential,
    credentialFallback: row.credentialFallback,
  };
}

export function logicMenuState(view: LogicRoutePublic | undefined, id: LogicRouteId): {
  selectable: boolean;
  label: "Astra" | "Sol" | "Luna";
  detail: string;
} {
  const label = LOGIC_ROUTE_LABEL[id];
  if (!view) {
    return {
      selectable: false,
      label,
      detail: `${label} readiness has not finished. This route cannot be selected yet. Nothing was sent.`,
    };
  }
  return {
    selectable: view.ready === true,
    label: view.label,
    detail: view.reason,
  };
}

export function activePickerLabel(input: {
  logicRoute: LogicRouteId | null;
  tierLabel: string;
  routes: LogicRoutePublic[];
}): string {
  if (!input.logicRoute) return input.tierLabel;
  const view = input.routes.find((item) => item.id === input.logicRoute);
  const label = LOGIC_ROUTE_LABEL[input.logicRoute];
  if (!view) return `${label} · not ready`;
  if (view.state === "needs-config") return `${label} · needs config`;
  if (view.state === "blocked") return `${label} · blocked`;
  if (view.state === "authenticated") return view.model ? `${label} · ${view.model}` : `${label} · authenticated`;
  return view.model ? `${label} · ${view.model}` : `${label} · configured`;
}

export type ChatTurnBodyInput = {
  text: string;
  memory: "off" | "on";
  halted: boolean;
  history: unknown[];
  memoryContext: unknown[];
  provider: string;
  modelTier: ModelTier;
  logicRoute: LogicRouteId | null;
  images: unknown[];
};

/** Client JSON for POST /api/mind/turn. The server re-resolves model and endpoint. */
export function chatTurnBody(input: ChatTurnBodyInput): Record<string, unknown> {
  return {
    text: input.text,
    memory: input.memory,
    halted: input.halted,
    history: input.history,
    memoryContext: input.memoryContext,
    provider: input.logicRoute ?? input.provider,
    modelTier: input.modelTier,
    ...(input.logicRoute ? { logicRoute: input.logicRoute } : {}),
    images: input.images,
  };
}

export function toAdapterMessages(
  messages: { role: string; content: unknown }[],
): { ok: true; messages: AdapterMessage[] } | { ok: false; error: string } {
  const out: AdapterMessage[] = [];
  for (const message of messages) {
    if (message.role !== "system" && message.role !== "user" && message.role !== "assistant") {
      return { ok: false, error: "That conversation could not be sent. Nothing was sent." };
    }
    if (typeof message.content !== "string") {
      return {
        ok: false,
        error: "This route accepts text only. Remove attached images. Nothing was sent. Another route was not substituted.",
      };
    }
    if (!message.content.trim()) {
      return { ok: false, error: "That conversation had an empty message. Nothing was sent." };
    }
    out.push({ role: message.role, content: message.content });
  }
  if (out.length === 0) return { ok: false, error: "Write a message first. Nothing was sent." };
  return { ok: true, messages: out };
}

/** Argv for `team/provider_router.py`. Model comes from provider.status. No API key. No --route auto fallback. */
export function adapterCliArgs(spec: ModelGenerateArgs): string[] {
  const args = ["--provider", spec.provider, "--prompt", JSON.stringify(spec.messages), "--timeout", String(spec.timeout_seconds)];
  if (spec.model) args.splice(2, 0, "--model", spec.model);
  return args;
}
