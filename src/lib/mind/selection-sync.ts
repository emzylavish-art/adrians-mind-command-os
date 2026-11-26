import type { StoredSelection } from "./logic-routes.ts";
import { readSelection, writeSelection } from "./logic-routes.ts";
import { isConnectedGrokModel } from "./model-tiers.ts";

export const SELECTION_FIELDS = ["provider", "modelTier", "logicRoute", "grokModel"] as const;
export function ownerSelectionStorage(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, owner: string) {
  const prefix = `amcos.owner.${encodeURIComponent(owner)}.`;
  return {
    getItem: (key: string) => storage.getItem(prefix + key),
    setItem: (key: string, value: string) => storage.setItem(prefix + key, value),
    removeItem: (key: string) => storage.removeItem(prefix + key),
  };
}

/** Write only locally changed fields into the latest storage snapshot. */
export function commitSelectionChanges(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, before: StoredSelection, next: StoredSelection): StoredSelection {
  const latest = readSelection(storage);
  const merged = { ...latest };
  for (const key of SELECTION_FIELDS) {
    if (before[key] !== next[key]) Object.assign(merged, { [key]: next[key] });
  }
  const changed = new Set(SELECTION_FIELDS.filter(key => before[key] !== next[key]));
  const keys: Record<string, keyof StoredSelection> = { "amcos.provider.v1": "provider", "amcos.modelTier.v1": "modelTier", "amcos.logicRoute.v1": "logicRoute", "amcos.grokModel.v1": "grokModel" };
  if (changed.has("provider") || changed.has("logicRoute")) changed.add("grokModel");
  writeSelection({
    setItem: (key, value) => { if (changed.has(keys[key] as typeof SELECTION_FIELDS[number])) storage.setItem(key, value); },
    removeItem: key => { if (changed.has(keys[key] as typeof SELECTION_FIELDS[number])) storage.removeItem(key); },
  }, merged);
  return readSelection(storage);
}

export function exactModelForChat(input: { botProvider?: string; botTier?: string; botExactModel?: string; selectedProvider: string; grokModel: string | null; providerModel?: string | null; savedModel?: string | null }): string | null {
  if (input.savedModel !== undefined) return input.savedModel;
  if (input.selectedProvider !== "grok") return input.providerModel ?? null;
  return input.botProvider || input.botTier ? (isConnectedGrokModel(input.botExactModel) ? input.botExactModel : null) : input.grokModel;
}
