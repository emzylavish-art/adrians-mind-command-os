/** Rank a provider catalogue without dropping models. */

const MODEL_ID = /^[~A-Za-z0-9][~A-Za-z0-9_.:/@-]*$/;

export function validCatalogModelId(value: string): boolean {
  return value.length > 0 && value.length <= 150 && MODEL_ID.test(value);
}

export const OPENROUTER_FREE_MODEL_REQUIRED = "Choose a specific OpenRouter model ending in :free. Automatic and paid models are unavailable in this route.";
export const OPENROUTER_FREE_ROUTING = { max_price: { prompt: 0, completion: 0, request: 0, image: 0 } };

export function isOpenRouterFreeModel(value: string): boolean {
  return validCatalogModelId(value) && /^[^/:]+\/[^/:]+:free$/.test(value);
}

export function parseCustomProviderChoice(value: unknown):
  { ok: true; id: string; model: string } | { ok: false; error: string } {
  if (typeof value !== "string" || !value.startsWith("custom:")) return { ok: false, error: "Not a custom provider selection." };
  const match = /^custom:([0-9a-f-]{36}):(.{1,450})$/i.exec(value);
  if (!match) return { ok: false, error: "Malformed custom provider selection." };
  let model: string;
  try { model = decodeURIComponent(match[2]); } catch { return { ok: false, error: "Invalid encoded model ID." }; }
  if (!validCatalogModelId(model)) return { ok: false, error: "Invalid custom model ID." };
  return { ok: true, id: match[1], model };
}

export type ModelExecution = {
  outcome: "succeeded" | "failed" | "rate_limited" | "permission_denied";
  at: string;
  requestedModel: string;
  reportedModel?: string;
  error?: string;
};
export type CatalogModelProfile = {
  id: string;
  inputModalities: string[];
  outputModalities: string[];
  contextTokens: number | null;
  promptPrice: number | null;
  completionPrice: number | null;
  supportsTools: boolean | null;
  supportsStructuredOutput?: boolean | null;
  lastExecution?: ModelExecution;
};
type CatalogRecord = Record<string, unknown> & {
  id?: unknown; name?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
};

function recordId(item: unknown): string {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";
  const row = item as CatalogRecord;
  return typeof row.id === "string" ? row.id : typeof row.name === "string" ? row.name : "";
}
/** Only explicit finite decimal prices count. null, booleans and blank strings are unknown. */
export function catalogPrice(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function modalities(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && /^[a-z_-]{1,30}$/i.test(item)).map((item) => item.toLowerCase()))] : [];
}
function execution(value: unknown, id: string): ModelExecution | undefined {
  if (!value || typeof value !== "object") return;
  const record = value as Partial<ModelExecution>;
  if (!["succeeded", "failed", "rate_limited", "permission_denied"].includes(record.outcome ?? "") || typeof record.at !== "string" || !Number.isFinite(Date.parse(record.at))) return;
  return { outcome: record.outcome!, at: record.at, requestedModel: id,
    reportedModel: typeof record.reportedModel === "string" ? record.reportedModel.slice(0, 150) : undefined,
    error: typeof record.error === "string" ? record.error.slice(0, 300) : undefined };
}
export function normalizeCatalogModels(found: unknown): CatalogModelProfile[] {
  const rows = Array.isArray(found) ? found : [];
  const seen = new Set<string>();
  const profiles: CatalogModelProfile[] = [];
  for (const item of rows) {
    const id = recordId(item);
    if (!validCatalogModelId(id) || seen.has(id)) continue;
    seen.add(id);
    const row: CatalogRecord = item && typeof item === "object" ? item as CatalogRecord : {};
    const context = row.contextTokens ?? row.context_length ?? row.input_token_limit;
    const parameters = row.supported_parameters;
    profiles.push({ id,
      inputModalities: modalities(row.inputModalities ?? row.architecture?.input_modalities),
      outputModalities: modalities(row.outputModalities ?? row.architecture?.output_modalities),
      contextTokens: typeof context === "number" && Number.isSafeInteger(context) && context > 0 ? context : null,
      promptPrice: catalogPrice(row.promptPrice ?? row.pricing?.prompt),
      completionPrice: catalogPrice(row.completionPrice ?? row.pricing?.completion),
      supportsTools: typeof row.supportsTools === "boolean" ? row.supportsTools : Array.isArray(parameters) ? parameters.includes("tools") : null,
      supportsStructuredOutput: typeof row.supportsStructuredOutput === "boolean" ? row.supportsStructuredOutput : Array.isArray(parameters) ? parameters.includes("response_format") || parameters.includes("structured_outputs") : null,
      lastExecution: execution(row.lastExecution, id),
    });
  }
  return profiles.sort((a, b) => Number(isFreeTextModel(b)) - Number(isFreeTextModel(a)));
}
export function isFreeTextModel(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const row = item as CatalogRecord;
  const prompt = catalogPrice(row.promptPrice ?? row.pricing?.prompt);
  const completion = catalogPrice(row.completionPrice ?? row.pricing?.completion);
  const outputs = row.outputModalities ?? row.architecture?.output_modalities;
  return prompt === 0 && completion === 0 && Array.isArray(outputs) && outputs.includes("text");
}
/** Keep every valid id while retaining full profiles through normalizeCatalogModels. */
export function rankCatalogModels(found: unknown): string[] {
  return normalizeCatalogModels(found).map((item) => item.id);
}
export type ModelRequirements = { input?: string[]; output?: string[]; tools?: boolean; structuredOutput?: boolean; freeOnly?: boolean; estimatedInputTokens?: number };
export function modelCompatibility(profile: CatalogModelProfile | undefined, requirements: ModelRequirements): { compatible: boolean; verified: boolean; reason: string } {
  if (requirements.freeOnly && (!profile || profile.promptPrice !== 0 || profile.completionPrice !== 0)) return { compatible: false, verified: false, reason: "Free-only mode cannot verify this model's pricing. Nothing was sent." };
  if (!profile) {
    if (requirements.tools || requirements.structuredOutput || [...(requirements.input ?? []), ...(requirements.output ?? [])].some((modality) => modality !== "text")) return { compatible: false, verified: false, reason: "The requested capability is not established for this model. Another model was not substituted." };
    return { compatible: true, verified: false, reason: "Model capabilities are unknown; the configured text route will check its response." };
  }
  if ((requirements.input ?? []).some((modality) => modality !== "text") && !profile.inputModalities.length) return { compatible: false, verified: false, reason: "The requested input capability is not established for this model. Nothing was sent." };
  if ((requirements.output ?? []).some((modality) => modality !== "text") && !profile.outputModalities.length) return { compatible: false, verified: false, reason: "The requested output capability is not established for this model. Nothing was sent." };
  for (const modality of requirements.input ?? ["text"]) if (profile.inputModalities.length && !profile.inputModalities.includes(modality)) return { compatible: false, verified: true, reason: `The selected model does not list ${modality} input support. Another model was not substituted.` };
  for (const modality of requirements.output ?? ["text"]) if (profile.outputModalities.length && !profile.outputModalities.includes(modality)) return { compatible: false, verified: true, reason: `The selected model does not list ${modality} output support. Another model was not substituted.` };
  if (requirements.tools && profile.supportsTools !== true) return { compatible: false, verified: profile.supportsTools === false, reason: "Tool support is not established for the selected model. Nothing was sent." };
  if (requirements.structuredOutput && profile.supportsStructuredOutput !== true) return { compatible: false, verified: profile.supportsStructuredOutput === false, reason: "Structured output support is not established for the selected model. Nothing was sent." };
  if (requirements.estimatedInputTokens && profile.contextTokens && requirements.estimatedInputTokens > profile.contextTokens) return { compatible: false, verified: true, reason: "The request exceeds the selected model's advertised context capacity. Shorten the input or explicitly choose another model." };
  return { compatible: true, verified: profile.inputModalities.length > 0 && profile.outputModalities.length > 0, reason: "The catalogue is compatible. Only an execution receipt can establish that a request succeeded." };
}

/** Every valid model from a connected API becomes its own selectable module. */
export function catalogModuleChoices(rows: { id: string; label: string; models: string[] }[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.id) continue;
    for (const model of row.models) {
      if (!validCatalogModelId(model)) continue;
      const id = `custom:${row.id}:${encodeURIComponent(model)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, label: `${row.label}: ${model}` });
    }
  }
  return out;
}

export type ProviderAvailability = { hasKey: boolean; status: string; retryAt?: string | null; rateLimitedModel?: string; model?: string };

export function customProviderBlockReason(row: ProviderAvailability): string | null {
  if (!row.hasKey) return "The provider needs a saved credential.";
  if (row.status === "catalogued" || row.status === "configured") return null;
  if (row.status === "billing_required") return "The provider requires billing or API credit. No paid fallback was selected.";
  if (row.status === "rate_limited") {
    if (row.model && row.rateLimitedModel && row.model !== row.rateLimitedModel) return null;
    if (row.retryAt && Date.parse(row.retryAt) <= Date.now()) return null;
    return row.retryAt ? `The selected model is temporarily rate limited. Try again explicitly after ${row.retryAt}.` : "The provider is rate limited. Refresh its status before an explicit retry.";
  }
  if (row.status === "quota_or_rate_limited") return "The provider reported a billing or rate limit. Refresh its connection before sending.";
  if (row.status === "credentials_rejected") return "The provider rejected its credential or permissions. Check the connection before sending.";
  if (row.status === "unavailable") return "The provider is unavailable. Refresh its connection before sending.";
  return "Provider readiness has not been established.";
}

export type DiscoveredCapability = {
  id: string;
  label: string;
  kind: "model" | "mcp-tool" | "service";
  usable: boolean;
  reason: string;
  model?: CatalogModelProfile;
  tool?: { inputSchema?: unknown; readOnly: boolean | null };
  service?: { accountId?: string; operations: string[] };
  readiness?: "configured" | "last_call_succeeded" | "last_call_failed" | "discovered" | "unavailable";
};

const TOOL_NAME = /^[A-Za-z0-9_-]{1,80}$/;

/** Models and MCP tools from a connection, with nothing dropped for being the wrong kind. */
export function discoveredCapabilities(input: {
  models: ({ id: string; label: string; models: string[]; modelProfiles?: CatalogModelProfile[] } & ProviderAvailability)[];
  mcp: { id: string; label: string; state: string; tools: { name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }[] }[];
  services?: { id: string; label: string; connected: boolean; opensWorkspace?: boolean; accountId?: string; operations?: string[] }[];
}): DiscoveredCapability[] {
  const models = input.models.flatMap((row) => {
    return catalogModuleChoices([row]).map((item) => {
      const parsed = parseCustomProviderChoice(item.id);
      const modelId = parsed.ok ? parsed.model : undefined;
      const reason = customProviderBlockReason({ ...row, model: modelId });
      const model = row.modelProfiles?.find((profile) => profile.id === modelId);
      const compatibility = modelCompatibility(model, { input: ["text"], output: ["text"] });
      const last = model?.lastExecution;
      const modelFailure = last && last.outcome !== "succeeded";
      return {
        ...item, kind: "model" as const, model,
        usable: !reason && compatibility.compatible,
        readiness: reason ? "unavailable" as const : modelFailure ? "last_call_failed" as const : last ? "last_call_succeeded" as const : "configured" as const,
        reason: reason ?? (!compatibility.compatible ? compatibility.reason : last
          ? `Last request ${last.outcome.replaceAll("_", " ")} at ${last.at}${last.reportedModel ? `; reported model ${last.reportedModel}` : "; reported model unknown"}. Sending checks availability again.`
          : "Configured for this API; this model has no successful execution receipt. Sending will check the model's response."),
      };
    });
  });
  const tools: DiscoveredCapability[] = [];
  const seen = new Set<string>();
  for (const server of input.mcp) {
    if (!server.id) continue;
    for (const tool of server.tools) {
      if (!TOOL_NAME.test(tool.name) || seen.has(`${server.id}:${tool.name}`)) continue;
      seen.add(`${server.id}:${tool.name}`);
      const usable = server.state === "connected";
      tools.push({
        id: `mcp:${server.id}:${encodeURIComponent(tool.name)}`,
        label: `${server.label}: ${tool.name}`,
        kind: "mcp-tool",
        tool: { inputSchema: tool.inputSchema, readOnly: typeof tool.annotations?.readOnlyHint === "boolean" ? tool.annotations.readOnlyHint : null },
        readiness: usable ? "discovered" : "unavailable",
        usable,
        reason: usable
          ? (tool.description || "Discovered MCP tool. Selecting it calls this tool. It is not sent to Grok.")
          : "This tool was listed, but the server has not answered. Nothing is called and Grok is not substituted.",
      });
    }
  }
  return [...models, ...tools, ...serviceCapabilities(input.services ?? [])];
}

export function serviceCapabilities(rows: { id: string; label: string; connected: boolean; opensWorkspace?: boolean; accountId?: string; operations?: string[] }[]): DiscoveredCapability[] {
  const out: DiscoveredCapability[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({
      id: `service:${row.id}`,
      label: row.label,
      kind: "service",
      service: { accountId: row.accountId, operations: row.operations ?? [] },
      usable: row.connected || row.opensWorkspace === true,
      reason: row.opensWorkspace
        ? `Open ${row.label}. The workspace checks its connection when opened.`
        : row.connected
        ? `${row.label} is connected. Selecting it opens that service. It is not sent to Grok.`
        : `${row.label} is not connected. Nothing was sent and Grok was not substituted.`,
    });
  }
  return out;
}

export function mcpToolCallText(choice: string, text: string): { ok: true; text: string; serverId: string; tool: string } | { ok: false; error: string } {
  const match = /^mcp:([0-9a-f-]{36}):([^:]{1,240})$/i.exec(choice);
  if (!match) return { ok: false, error: "That is not a discovered MCP tool. Nothing was called." };
  let name = "";
  try { name = decodeURIComponent(match[2]); } catch { return { ok: false, error: "That tool name could not be read. Nothing was called." }; }
  if (!TOOL_NAME.test(name)) return { ok: false, error: "That tool name is not usable. Nothing was called." };
  return { ok: true, serverId: match[1], tool: name, text: `call mcp tool ${name} on server ${match[1]} ${text.trim()}`.trim() };
}
