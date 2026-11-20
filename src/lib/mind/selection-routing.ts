/**
 * Chat provider selection. Astra, Sol, and Luna are the verified Worker routes.
 * OpenAI is only the credential fallback those routes already publish.
 * Claude, Gemini, OpenRouter, and Ollama persist but do not send.
 */

import type { LogicRouteId, LogicRoutePublic, ModelTier } from "./logic-routes.ts";
import { isLogicRouteId, LOGIC_ROUTE_LABEL } from "./logic-routes.ts";
import type { RouteFailureAction } from "./route-failure.ts";
import { routeFailureAction } from "./route-failure.ts";

export const UNWIRED_PROVIDERS = ["anthropic", "gemini", "openrouter", "ollama"] as const;
export type UnwiredProviderId = (typeof UNWIRED_PROVIDERS)[number];

export const UNWIRED_ENV: Record<UnwiredProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  ollama: "OLLAMA_MODEL",
};

export const ORCHESTRATORS = ["grok", "astra"] as const;
export type OrchestratorId = (typeof ORCHESTRATORS)[number];
export const ORCHESTRATOR_STORAGE_KEY = "amcos.orchestrator.v1";

export type TurnSelection = {
  provider: string;
  modelTier: ModelTier;
  logicRoute: LogicRouteId | null;
  orchestrator: OrchestratorId | null;
};

export function isUnwiredProvider(id: string): id is UnwiredProviderId {
  return (UNWIRED_PROVIDERS as readonly string[]).includes(id);
}

export function isOrchestratorId(value: unknown): value is OrchestratorId {
  return value === "grok" || value === "astra";
}

export function unwiredProviderMessage(id: UnwiredProviderId): string {
  const env = UNWIRED_ENV[id];
  return `No adapter wired for ${id}. Needs ${env}. No verified Worker route exists, so setting ${env} does not send. Nothing was sent.`;
}

export function selectionIdentity(selection: TurnSelection): string {
  return JSON.stringify([selection.provider, selection.modelTier, selection.logicRoute, selection.orchestrator]);
}

/** Retry always resends the selection captured on the failed turn. */
export function selectionForRetry(original: TurnSelection, _later: TurnSelection): TurnSelection {
  return original;
}

export function claimSend(inFlight: boolean): boolean {
  return !inFlight;
}

export type TurnFeedback = { error: string | null; liveText: string; notice: string | null };

export function feedbackAfterSelectionChange(previousKey: string, nextKey: string, feedback: TurnFeedback): TurnFeedback {
  if (previousKey === nextKey) return feedback;
  return { error: null, liveText: "", notice: null };
}

export function dismissFailure(): null {
  return null;
}

export function legacyProviderOption(id: string, grokConfigured: boolean | null): { id: string; label: string; enabled: boolean; reason: string } {
  if (id === "grok") {
    return {
      id,
      label: "Grok",
      enabled: true,
      reason:
        grokConfigured === true
          ? "Configured. The app xAI path is used on Send. That is not a live authentication."
          : grokConfigured === false
            ? "Needs config. Missing XAI_API_KEY. Nothing is sent until the key is present."
            : "Grok status has not finished.",
    };
  }
  if (id === "openai") {
    return {
      id,
      label: "OpenAI",
      enabled: true,
      reason: "No standalone OpenAI adapter. Send uses Astra, Sol, or Luna only when provider.status reports an OPENAI_API_KEY fallback.",
    };
  }
  if (isUnwiredProvider(id)) {
    return { id, label: id, enabled: true, reason: unwiredProviderMessage(id) };
  }
  return { id, label: id, enabled: false, reason: "That provider is not known. Nothing was sent." };
}

export function providerBoardCards(input: {
  grokConfigured: boolean | null;
  logicRoutes: LogicRoutePublic[];
  openAiKeyPresent?: boolean;
}): { name: string; state: string; detail: string }[] {
  const grok =
    input.grokConfigured === true
      ? { name: "Grok", state: "Configured", detail: "XAI_API_KEY is present. This is not a live authentication and not Connected." }
      : input.grokConfigured === false
        ? { name: "Grok", state: "Needs config", detail: "Needs XAI_API_KEY. Nothing is sent." }
        : { name: "Grok", state: "Checking", detail: "Grok status has not finished." };
  const openAiRoutes = input.logicRoutes.filter((item) => item.credentialFallback === "OPENAI_API_KEY" && item.ready);
  const openAiKeyPresent = input.openAiKeyPresent === true;
  const openai =
    openAiRoutes.length > 0
      ? {
          name: "OpenAI",
          state: "Configured",
          detail: `OPENAI_API_KEY is the credential fallback for ${openAiRoutes.map((item) => item.label).join(", ")}. This is not a standalone OpenAI adapter and not Connected.`,
        }
      : openAiKeyPresent
        ? {
            name: "OpenAI",
            state: "Configured",
            detail: "OPENAI_API_KEY is present on this machine. The key is not displayed. A chat connection still requires the provider route to report ready.",
          }
      : {
          name: "OpenAI",
          state: "Needs config",
          detail: "No adapter wired. Needs OPENAI_API_KEY as the Astra, Sol, or Luna fallback. Nothing is sent.",
        };
  const unwired = UNWIRED_PROVIDERS.map((id) => ({
    name: id === "anthropic" ? "Claude" : id === "gemini" ? "Gemini" : id === "openrouter" ? "OpenRouter" : "Ollama",
    state: "Needs config",
    detail: unwiredProviderMessage(id),
  }));
  const logic = input.logicRoutes.map((item) => ({
    name: item.label,
    state: item.state === "needs-config" ? "Needs config" : item.state === "blocked" ? "Blocked" : item.state === "authenticated" ? "Authenticated" : "Configured",
    detail: item.reason,
  }));
  return [grok, openai, ...unwired, ...logic];
}

export function resolveOpenAiFallback(routes: LogicRoutePublic[]): { ok: true; route: LogicRouteId; note: string } | { ok: false; error: string; state: "needs-config" } {
  const ready = routes.filter((item) => item.ready && item.credentialFallback === "OPENAI_API_KEY");
  if (ready.length === 1) {
    const route = ready[0]!;
    return {
      ok: true,
      route: route.id,
      note: `OpenAI has no adapter of its own. This send uses ${route.label} because provider.status reported credential fallback OPENAI_API_KEY.`,
    };
  }
  if (ready.length > 1) {
    return {
      ok: false,
      state: "needs-config",
      error: `No standalone OpenAI adapter. ${ready.map((item) => item.label).join(" and ")} are both configured with OPENAI_API_KEY. Choose Astra, Sol, or Luna. Nothing was sent.`,
    };
  }
  return {
    ok: false,
    state: "needs-config",
    error: "No adapter wired for OpenAI. Needs OPENAI_API_KEY as the Astra, Sol, or Luna fallback. Nothing was sent.",
  };
}

export type TurnGate =
  | { ok: true; provider: string; logicRoute: LogicRouteId | null; modelTier: ModelTier; orchestrator: OrchestratorId | null; note: string | null; failureAction: RouteFailureAction }
  | { ok: false; error: string; failureAction: "setup"; missing: string[] };

export function gateTurn(selection: TurnSelection, routes: LogicRoutePublic[], grokConfigured: boolean | null): TurnGate {
  const orchestrator = selection.orchestrator;
  if (orchestrator === "astra") {
    const astra = routes.find((item) => item.id === "astra");
    if (!astra?.ready) {
      return {
        ok: false,
        failureAction: "setup",
        missing: astra?.missing ?? ["ASTRA_API_KEY", "OPENAI_API_KEY"],
        error: astra?.reason ?? `${LOGIC_ROUTE_LABEL.astra} needs config. Fan-out is not wired. Nothing was sent.`,
      };
    }
    return {
      ok: true,
      provider: "astra",
      logicRoute: "astra",
      modelTier: selection.modelTier,
      orchestrator,
      note: "Orchestrator fan-out is not wired. This turn uses Astra.",
      failureAction: "retry",
    };
  }
  if (isLogicRouteId(selection.logicRoute) || isLogicRouteId(selection.provider)) {
    const id = (selection.logicRoute ?? selection.provider) as LogicRouteId;
    const view = routes.find((item) => item.id === id);
    if (!view?.ready) {
      const action = routeFailureAction({ state: view?.state ?? "needs-config", error: view?.reason });
      return {
        ok: false,
        failureAction: action === "setup" ? "setup" : "setup",
        missing: view?.missing ?? [],
        error: view?.reason ?? `${LOGIC_ROUTE_LABEL[id]} is not ready. Nothing was sent.`,
      };
    }
    return {
      ok: true,
      provider: id,
      logicRoute: id,
      modelTier: selection.modelTier,
      orchestrator,
      note: orchestrator ? `Orchestrator fan-out is not wired. This turn uses ${LOGIC_ROUTE_LABEL[id]}.` : null,
      failureAction: "retry",
    };
  }
  if (selection.provider === "openai") {
    const resolved = resolveOpenAiFallback(routes);
    if (!resolved.ok) return { ok: false, error: resolved.error, failureAction: "setup", missing: ["OPENAI_API_KEY"] };
    return {
      ok: true,
      provider: resolved.route,
      logicRoute: resolved.route,
      modelTier: selection.modelTier,
      orchestrator,
      note: resolved.note,
      failureAction: "retry",
    };
  }
  if (isUnwiredProvider(selection.provider)) {
    return { ok: false, error: unwiredProviderMessage(selection.provider), failureAction: "setup", missing: [UNWIRED_ENV[selection.provider]] };
  }
  if (selection.provider === "grok" || selection.provider === "") {
    if (grokConfigured === false) {
      return { ok: false, error: "Needs config. Missing XAI_API_KEY. Nothing was sent.", failureAction: "setup", missing: ["XAI_API_KEY"] };
    }
    return {
      ok: true,
      provider: "grok",
      logicRoute: null,
      modelTier: selection.modelTier,
      orchestrator: orchestrator === "grok" ? "grok" : null,
      note: orchestrator === "grok" ? "Orchestrator fan-out is not wired. This turn uses the selected Grok model." : null,
      failureAction: "retry",
    };
  }
  return { ok: false, error: "That provider is not known. Nothing was sent. Another provider is not substituted.", failureAction: "setup", missing: [] };
}

export function readOrchestrator(raw: string | null): OrchestratorId {
  return isOrchestratorId(raw) ? raw : "grok";
}
