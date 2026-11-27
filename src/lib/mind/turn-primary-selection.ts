import { isAvailableGrokSelection, resolveModelTier, type ConcreteModelTier, type ModelControls } from "./model-tiers.ts";
import { environmentModelReadiness, type EnvironmentModelCatalog } from "./environment-model-catalog.ts";
import { NEMOTRON_MODEL, selectProvider, httpStatusForProviderSelection } from "./provider-call.ts";

type Configuration = { ok: true; provider: string; model: string; supportsImages: boolean } | { ok: false; error: string; status: number };

/** No network call or budget reservation: establish the primary request before any helpers can run. */
export function validatePrimaryConfiguration(input: {
  provider?: unknown; requestedModel?: unknown; modelTier?: unknown; previousTier?: unknown;
  text: string; imageCount: number; controls: ModelControls; memory?: unknown; saveMemory?: unknown; chatId?: unknown;
  custom?: { model: string; imageInput: boolean };
  logic?: { id: string; model: string | null; ready: boolean; reason: string };
  xai: { ok: boolean; error?: string };
  catalog?: EnvironmentModelCatalog;
}, env: Record<string, string | undefined>): Configuration {
  const fail = (error: string, status = 400): Configuration => ({ ok: false, error, status });
  if (input.memory === "on" && typeof input.saveMemory === "string" && input.saveMemory.trim()
    && !(typeof input.chatId === "string" && input.chatId.trim())) return fail("Select a conversation before saving chat memory. No helper was called.");
  if (!input.text && !input.imageCount) return fail("Write a message first. No helper was called.");
  if (input.requestedModel != null && typeof input.requestedModel !== "string") return fail("The selected model is invalid. No helper was called.");
  const requested = typeof input.requestedModel === "string" ? input.requestedModel.trim() : "";
  const provider = input.provider == null || input.provider === "" ? "grok" : input.provider;
  if (typeof provider !== "string") return fail("That provider is not known. No helper was called.");
  const checkModel = (model: string) => !requested || requested === model;
  if (input.logic) {
    if (input.imageCount) return fail(`${input.logic.id} cannot see images in this app. Nothing was sent.`);
    if (!input.logic.ready || !input.logic.model) return fail(input.logic.reason || "The selected route is not ready. No helper was called.", 503);
    if (!checkModel(input.logic.model)) return fail("The configured model changed. Choose the current model before sending again.", 409);
    return { ok: true, provider: input.logic.id, model: input.logic.model, supportsImages: false };
  }
  if (provider.startsWith("custom:")) {
    if (!input.custom) return fail("The selected provider has not passed its connection check. No helper was called.");
    if (!checkModel(input.custom.model)) return fail("The selected model changed. Review the current selection before sending again.", 409);
    if (input.imageCount && !input.custom.imageInput) return fail("The selected model does not declare image input. No helper was called.");
    return { ok: true, provider, model: input.custom.model, supportsImages: input.custom.imageInput };
  }
  if (provider !== "grok" && input.imageCount) return fail(`${provider} cannot see images in this app. Remove the images before sending. No helper was called.`);
  if (provider === "grok") {
    if (!input.xai.ok) return fail(input.xai.error || "No Grok inference key is configured. No helper was called.", 503);
    if (requested && !isAvailableGrokSelection(requested, env, input.catalog)) return fail("The selected Grok model is not available in the current model catalogue. No helper was called.");
    const previousTier = ["Fast", "Expert", "Heavy", "Build"].includes(String(input.previousTier)) ? input.previousTier as ConcreteModelTier : undefined;
    const resolved = resolveModelTier(input.modelTier, input.text || "image", env, { controls: input.controls, previousTier });
    const model = requested || resolved.model;
    const readiness = environmentModelReadiness(input.catalog, model, { images: input.imageCount, outputTokens: resolved.params.max_tokens });
    if (!readiness.ok) return fail(readiness.error, 409);
    if (!isAvailableGrokSelection(model, env, input.catalog)) return fail("That model is not available. No helper was called.");
    return { ok: true, provider, model, supportsImages: readiness.availability === "catalogued" ? readiness.capabilities?.imageInput === "supported" : true };
  }
  if (provider === "nemotron") {
    if (!env.OPENROUTER_API_KEY?.trim()) return fail("OpenRouter is selected, but no OpenRouter key is connected. No helper was called.", 503);
    if (!checkModel(NEMOTRON_MODEL)) return fail("The configured model changed. Choose the current model before sending again.", 409);
    return { ok: true, provider, model: NEMOTRON_MODEL, supportsImages: false };
  }
  if (provider === "ollama") {
    if (!env.LOCAL_MODEL_URL?.trim()) return fail("Local model is selected, but no local runner is configured. No helper was called.", 503);
    let url: URL;
    try { url = new URL(env.LOCAL_MODEL_URL); } catch { return fail("The configured local runner URL is invalid. No helper was called.", 503); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return fail("The configured local runner URL is not supported. No helper was called.", 503);
    if (input.controls.answerTokens !== undefined && url.pathname.replace(/\/$/, "") !== "/api/generate") return fail("The configured local runner does not declare the native Ollama answer-budget contract. Choose the provider default or configure its /api/generate endpoint. Nothing was sent.");
    const model = env.OLLAMA_MODEL?.trim() || "local";
    if (!checkModel(model)) return fail("The configured model changed. Choose the current model before sending again.", 409);
    return { ok: true, provider, model, supportsImages: false };
  }
  const selected = selectProvider(provider, env);
  if (!selected.ok) return fail(selected.error, httpStatusForProviderSelection(selected.error));
  if (!checkModel(selected.model)) return fail("The configured model changed. Choose the current model before sending again.", 409);
  return { ok: true, provider, model: selected.model, supportsImages: false };
}
