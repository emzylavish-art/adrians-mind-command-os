/**
 * Intent catalog built from real app destinations / actions.
 * Reuses PALETTE_DESTINATIONS, MODEL_TIERS, WORKSPACE_ROUTE_LINKS.
 */
import { PALETTE_DESTINATIONS } from "../mind/palette.ts";
import { MODEL_TIERS } from "../mind/model-tiers.ts";
import { WORKSPACE_ROUTE_LINKS } from "../mind/workspace-nav.ts";
import type { CatalogIntent } from "./types.ts";

function uniqById(items: CatalogIntent[]): CatalogIntent[] {
  const seen = new Set<string>();
  const out: CatalogIntent[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/** Static catalog (~dozens of intents). Safe to call every keystroke. */
export function buildIntentCatalog(): CatalogIntent[] {
  const rows: CatalogIntent[] = [];

  for (const dest of PALETTE_DESTINATIONS) {
    rows.push({
      id: `view:${dest.id}`,
      label: `Go to ${dest.label}`,
      aliases: [dest.label, dest.id, `open ${dest.label}`, `show ${dest.label}`, `navigate ${dest.label}`],
      action: { type: "view", view: dest.id },
    });
  }

  for (const link of WORKSPACE_ROUTE_LINKS) {
    rows.push({
      id: `route:${link.href}`,
      label: `Open ${link.label}`,
      aliases: [link.label, link.href.replace(/^\//, ""), `go to ${link.label}`, `open ${link.label}`],
      action: { type: "route", href: link.href },
    });
  }

  // Standalone TanStack routes that exist beside the in-app View shell.
  for (const route of [
    { href: "/explore", label: "Explore", aliases: ["explore", "discover", "open explore"] },
    { href: "/memory", label: "Memory", aliases: ["memory page", "notes page", "open memory", "search memory"] },
    { href: "/personas", label: "Personas", aliases: ["personas", "persona directory", "open personas"] },
    { href: "/dashboard", label: "Universe Dashboard", aliases: ["universe", "3d dashboard", "cosmos"] },
  ] as const) {
    rows.push({
      id: `route:${route.href}`,
      label: `Open ${route.label}`,
      aliases: [...route.aliases, route.label, route.href.replace(/^\//, "")],
      action: { type: "route", href: route.href },
    });
  }

  rows.push({
    id: "action:open-model-picker",
    label: "Open model picker",
    aliases: ["model", "models", "picker", "change model", "switch model", "model tier"],
    action: { type: "open-model-picker" },
  });

  for (const tier of MODEL_TIERS) {
    rows.push({
      id: `model:${tier}`,
      label: `Switch model to ${tier}`,
      aliases: [tier, `model ${tier}`, `use ${tier}`, `set ${tier}`, `${tier} tier`],
      action: { type: "model", tier },
    });
  }

  rows.push({
    id: "action:start-voice",
    label: "Start voice",
    aliases: ["voice", "speak", "listen", "mic", "microphone", "dictate", "talk", "start voice", "push to talk"],
    action: { type: "start-voice" },
  });

  rows.push({
    id: "action:open-palette",
    label: "Open command palette",
    aliases: ["palette", "command palette", "commands", "ctrl k", "cmd k", "search commands"],
    action: { type: "open-palette" },
  });

  rows.push({
    id: "action:search-memory",
    label: "Search memory",
    aliases: ["search notes", "find note", "search memory", "look up notes", "memory search"],
    action: { type: "search-memory" },
  });

  return uniqById(rows);
}

let cached: CatalogIntent[] | null = null;

export function getIntentCatalog(): CatalogIntent[] {
  if (!cached) cached = buildIntentCatalog();
  return cached;
}

/** Test helper — reset memoized catalog after stubbing imports is impractical; rebuild via this. */
export function resetIntentCatalogCache(): void {
  cached = null;
}
