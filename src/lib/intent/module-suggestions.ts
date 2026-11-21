import { rankIntents } from "./ranker.ts";
import type { RankedIntent } from "./types.ts";

export type ModuleCategory = "Work" | "Connect" | "Voice" | "Account";

export type ModuleSuggestion = {
  id: string;
  label: string;
  category: ModuleCategory;
  action: "view" | "speak" | "dictate" | "model";
  view?: string;
  tier?: string;
};

const VISUAL_DROP = /dashboard|universe|\b3d\b/i;
const DICTATION_QUERY = /\b(dictat\w*|microphone|\bmic\b|whisper|handy|transcrib\w*)\b/i;
const SPEAK_QUERY = /\b(speak|call)\b/i;

function categoryFor(view: string): ModuleCategory {
  if (view === "connected" || view === "integrations") return "Connect";
  if (view === "settings" || view === "help" || view === "memory" || view === "activity") return "Account";
  return "Work";
}

function labelFor(row: RankedIntent): string {
  if (row.action.type === "view" && row.action.view === "code") return "Open Intelligence";
  return row.label.replace("Human Code", "Intelligence");
}

function pushUnique(out: ModuleSuggestion[], item: ModuleSuggestion) {
  if (out.some((row) => row.id === item.id)) return;
  out.push(item);
}

function voiceItems(query: string): ModuleSuggestion[] {
  const dictate = DICTATION_QUERY.test(query);
  const speak = SPEAK_QUERY.test(query);
  const items: ModuleSuggestion[] = [];
  if (speak || !dictate) {
    items.push({ id: "voice:speak", label: "Speak", category: "Voice", action: "speak" });
  }
  if (dictate || !speak) {
    items.push({ id: "voice:dictate", label: "Dictation", category: "Voice", action: "dictate" });
  }
  if (speak && !dictate) return items.filter((item) => item.action === "speak");
  if (dictate && !speak) return items.filter((item) => item.action === "dictate");
  return items;
}

/** Rank the restored GitHub catalog, then keep only modules this shell can open. */
export function suggestModules(query: string): ModuleSuggestion[] {
  const text = query.trim();
  if (!text) return [];
  if (DICTATION_QUERY.test(text) || SPEAK_QUERY.test(text)) {
    return voiceItems(text);
  }
  const ranked = rankIntents(text, { storage: null, limit: 8, minScore: 0.55 });
  let out: ModuleSuggestion[] = [];
  for (const row of ranked) {
    if (VISUAL_DROP.test(row.id) || VISUAL_DROP.test(row.label)) continue;
    if (row.action.type === "route") continue;
    if (row.action.type === "view") {
      if (row.action.view === "dashboard") continue;
      pushUnique(out, {
        id: row.id,
        label: labelFor(row),
        category: categoryFor(row.action.view),
        action: "view",
        view: row.action.view,
      });
      continue;
    }
    if (row.action.type === "start-voice") {
      for (const item of voiceItems(text)) pushUnique(out, item);
      continue;
    }
    if (row.action.type === "search-memory") {
      pushUnique(out, { id: "view:memory", label: "Open Memory", category: "Account", action: "view", view: "memory" });
      continue;
    }
    if (row.action.type === "model") {
      pushUnique(out, { id: row.id, label: row.label, category: "Account", action: "model", tier: row.action.tier });
      continue;
    }
    if (row.action.type === "open-model-picker") {
      pushUnique(out, { id: "view:settings", label: "Open Settings", category: "Account", action: "view", view: "settings" });
    }
  }
  if (/\bintelligence\b/i.test(text)) {
    out = out.filter((item) => item.id !== "view:code");
    out.unshift({ id: "view:code", label: "Open Intelligence", category: "Work", action: "view", view: "code" });
  }
  return out.slice(0, 6);
}

export function suggestionCategories(items: ModuleSuggestion[]): ModuleCategory[] {
  const order: ModuleCategory[] = ["Work", "Connect", "Voice", "Account"];
  return order.filter((category) => items.some((item) => item.category === category));
}
