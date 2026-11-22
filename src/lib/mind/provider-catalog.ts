/** Rank a provider catalogue without dropping models. */

const MODEL_ID = /^[~A-Za-z0-9][~A-Za-z0-9_.:/@-]*$/;

export function validCatalogModelId(value: string): boolean {
  return value.length > 0 && value.length <= 150 && MODEL_ID.test(value);
}

type CatalogRecord = {
  id?: unknown;
  name?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { output_modalities?: unknown };
};

function recordId(item: unknown): string {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";
  const row = item as CatalogRecord;
  return typeof row.id === "string" ? row.id : typeof row.name === "string" ? row.name : "";
}

export function isFreeTextModel(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const row = item as CatalogRecord;
  const prompt = Number(row.pricing?.prompt);
  const completion = Number(row.pricing?.completion);
  const outputs = row.architecture?.output_modalities;
  return prompt === 0 && completion === 0 && Array.isArray(outputs) && outputs.includes("text");
}

/** Keep every valid id. Zero-price text models stay first, in catalog order. */
export function rankCatalogModels(found: unknown): string[] {
  const rows = Array.isArray(found) ? found : [];
  const ranked: { id: string; freeText: boolean; index: number }[] = [];
  const seen = new Set<string>();
  rows.forEach((item, index) => {
    const id = recordId(item);
    if (!validCatalogModelId(id) || seen.has(id)) return;
    seen.add(id);
    ranked.push({ id, freeText: isFreeTextModel(item), index });
  });
  ranked.sort((a, b) => Number(b.freeText) - Number(a.freeText) || a.index - b.index);
  return ranked.map((item) => item.id);
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

export type DiscoveredCapability = {
  id: string;
  label: string;
  kind: "model" | "mcp-tool";
  usable: boolean;
  reason: string;
};

const TOOL_NAME = /^[A-Za-z0-9_-]{1,80}$/;

/** Models and MCP tools from a connection, with nothing dropped for being the wrong kind. */
export function discoveredCapabilities(input: {
  models: { id: string; label: string; models: string[] }[];
  mcp: { id: string; label: string; state: string; tools: { name: string; description?: string }[] }[];
}): DiscoveredCapability[] {
  const models = catalogModuleChoices(input.models).map((item) => ({
    ...item,
    kind: "model" as const,
    usable: true,
    reason: "Discovered model. It sends to that API and is not substituted with Grok.",
  }));
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
        usable,
        reason: usable
          ? (tool.description || "Discovered MCP tool. Selecting it calls this tool. It is not sent to Grok.")
          : "This tool was listed, but the server has not answered. Nothing is called and Grok is not substituted.",
      });
    }
  }
  return [...models, ...tools];
}

export function mcpToolCallText(choice: string, text: string): { ok: true; text: string } | { ok: false; error: string } {
  const match = /^mcp:[0-9a-f-]{36}:([^:]{1,240})$/i.exec(choice);
  if (!match) return { ok: false, error: "That is not a discovered MCP tool. Nothing was called." };
  let name = "";
  try { name = decodeURIComponent(match[1]); } catch { return { ok: false, error: "That tool name could not be read. Nothing was called." }; }
  if (!TOOL_NAME.test(name)) return { ok: false, error: "That tool name is not usable. Nothing was called." };
  return { ok: true, text: `call mcp tool ${name} ${text.trim()}`.trim() };
}
