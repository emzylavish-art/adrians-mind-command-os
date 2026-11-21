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
