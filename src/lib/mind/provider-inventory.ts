import { ENVIRONMENT_PROVIDERS, environmentProvider, normalizeEnvironmentCatalog, type EnvironmentModelCatalog } from "./environment-model-catalog.ts";
import type { ModelCapabilityRegistry } from "./model-capabilities.ts";
import { parseCustomProviderChoice } from "./provider-catalog.ts";
import type { ProviderCapabilities } from "./provider-lifecycle.ts";
import type { UsageEntry } from "./types.ts";

export type InventoryModality = "Reasoning" | "Vision" | "Transcription" | "Synthesis" | "Image generation" | "Realtime audio" | "Tools";
export const PROVIDER_MODALITIES: readonly InventoryModality[] = ["Reasoning", "Vision", "Transcription", "Synthesis", "Image generation", "Realtime audio", "Tools"];
type Support = "Implemented" | "Model-dependent" | "Unconfirmed" | "Unsupported";
type CustomConnection = { id: string; label: string; hasKey: boolean; status: string; models: string[]; defaultModel: string; capabilities?: ProviderCapabilities; modelCapabilities?: ModelCapabilityRegistry; inferenceModel?: string; inferenceVerifiedAt?: string | null };
type InventoryRow = { id: string; label: string; configuration: string; discovery: string; selection: string; model: string | null; capabilities: Record<InventoryModality, Support>; evidence: string };
const labels = { grok: "xAI", openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini", openrouter: "OpenRouter · free only", ollama: "Ollama" };

function audioSupport(value: ProviderCapabilities["speech"] | undefined): Support {
  return value === "implemented" ? "Implemented" : value === "not_wired" ? "Unsupported" : "Unconfirmed";
}

function visionFor(registry: ModelCapabilityRegistry | undefined, model: string | null, fallback: Support): Support {
  if (!model) return fallback;
  const vision = registry?.[model]?.imageInput;
  return vision === "supported" ? "Implemented" : vision === "unsupported" ? "Unsupported" : "Unconfirmed";
}

function newestAnswer(rows: readonly UsageEntry[], provider: string, model: string | null) {
  return rows.reduce<UsageEntry | undefined>((newest, row) => {
    const matching = environmentProvider(row.provider?.toLowerCase()) === provider && row.model !== "unknown" && (!model || row.model === model);
    if (!matching || row.stage !== "answer" || row.providerDispatch !== "sent" || row.outcome !== "completed" || !row.requestId) return newest;
    return !newest || row.at > newest.at ? row : newest;
  }, undefined);
}

export function providerInventory(input: {
  catalogs: readonly EnvironmentModelCatalog[];
  configured: Partial<Record<keyof typeof labels, boolean | null>>;
  selected: string;
  models: Record<string, string | null | undefined>;
  choices: readonly { id: string; enabled: boolean }[];
  custom: readonly CustomConnection[];
  usage: readonly UsageEntry[];
}, now = Date.now()): InventoryRow[] {
  const native = ENVIRONMENT_PROVIDERS.map(id => {
    const catalog = normalizeEnvironmentCatalog(input.catalogs.find(entry => entry.provider === id), now);
    const configured = catalog?.configured ?? input.configured[id];
    const selected = environmentProvider(input.selected) === id;
    const model = input.models[id] || (selected ? input.models[input.selected] : null) || null;
    const selectable = input.choices.some(choice => environmentProvider(choice.id) === id && choice.enabled);
    const answer = newestAnswer(input.usage, id, model);
    return {
      id, label: labels[id], configuration: configured === true ? "Configured" : configured === false ? "Unavailable" : "Unconfirmed",
      discovery: catalog?.state === "catalogued" ? `${catalog.models.length} listed models` : catalog?.state === "stale" ? "Catalogue stale" : catalog?.state === "unavailable" ? "Discovery unavailable" : "Catalogue unverified",
      selection: selected ? selectable ? "Selected for Chat" : "Selected route unavailable" : selectable ? "Selectable for Chat" : "Unavailable for Chat",
      model, evidence: answer ? `Confirmed answer receipt · ${answer.model} · ${answer.at.slice(0, 10)}` : "No confirmed answer receipt for this model.",
      capabilities: {
        Reasoning: "Implemented", Vision: visionFor(catalog?.capabilities, model, "Model-dependent"),
        Transcription: id === "grok" || id === "openai" ? "Implemented" : "Unsupported",
        Synthesis: id === "grok" || id === "openai" ? "Implemented" : "Unsupported",
        "Image generation": id === "grok" ? "Implemented" : "Unsupported",
        "Realtime audio": id === "grok" ? "Implemented" : "Unsupported",
        Tools: "Unsupported",
      },
    } satisfies InventoryRow;
  });
  const current = parseCustomProviderChoice(input.selected);
  const custom = input.custom.map(connection => {
    const selected = current.ok && current.id === connection.id;
    const model = (selected ? current.model : connection.defaultModel) || null;
    const selectable = input.choices.some(choice => { const parsed = parseCustomProviderChoice(choice.id); return parsed.ok && parsed.id === connection.id && choice.enabled; });
    return {
      id: `custom:${connection.id}`, label: connection.label, configuration: connection.hasKey ? "Configured" : "Unavailable",
      discovery: connection.status === "catalogued" ? `${connection.models.length} listed models` : connection.status.replaceAll("_", " "),
      selection: selected ? selectable ? "Selected for Chat" : "Selected route unavailable" : selectable ? "Selectable for Chat" : "Unavailable for Chat",
      model, evidence: model && connection.inferenceModel === model && connection.inferenceVerifiedAt ? `Confirmed answer receipt · ${model} · ${connection.inferenceVerifiedAt.slice(0, 10)}` : "No confirmed answer receipt for this model.",
      capabilities: {
        Reasoning: "Implemented", Vision: visionFor(connection.modelCapabilities, model, "Model-dependent"),
        Transcription: audioSupport(connection.capabilities?.transcription),
        Synthesis: audioSupport(connection.capabilities?.speech),
        "Image generation": "Unsupported", "Realtime audio": "Unsupported", Tools: "Unsupported",
      },
    } satisfies InventoryRow;
  });
  return [...native, ...custom];
}
