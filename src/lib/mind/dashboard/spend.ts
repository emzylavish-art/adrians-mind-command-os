/**
 * Queue #7 — MONEY filesystem adapter (server-only; do not import from client UI).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_EVENTS,
  NO_SPEND_SOURCE,
  buildMoneyView,
  parseSpendFileText,
  type MoneyView,
  type SpendAdapter,
  type SpendLoadContext,
  type SpendLoadResult,
} from "./spend-core.ts";

export * from "./spend-core.ts";

export const SPEND_FILE_RE = /spend|usage|cost|billing/i;
export const SPEND_EXT_RE = /\.(json|jsonl|ndjson|log|csv)$/i;

const DEFAULT_ROOTS = [
  "/workspace",
  "/workspace/.handoff",
  "/workspace/audit/dashboard-3d",
  "/workspace/mind-command-os-xai",
  "/workspace/mind-command-os-dashboard/.handoff",
];

const MAX_FILE_BYTES = 2_000_000;
export const MAX_SPEND_FILES = 8;

export function createFilesystemSpendAdapter(opts?: { roots?: string[] }): SpendAdapter {
  const roots = opts?.roots ?? DEFAULT_ROOTS;
  return {
    id: "filesystem-spend",
    load(ctx: SpendLoadContext = {}): SpendLoadResult {
      const nowMs = Number.isFinite(ctx.nowMs) ? (ctx.nowMs as number) : Date.now();
      const exists = ctx.exists ?? existsSync;
      const listNames = ctx.listNames ?? ((dir: string) => readdirSync(dir));
      const readText = ctx.readText ?? ((path: string) => readFileSync(path, "utf8"));
      const statSize =
        ctx.statSize ??
        ((path: string) => {
          try {
            return statSync(path).size;
          } catch {
            return 0;
          }
        });
      const searchRoots = ctx.roots ?? roots;
      const statModifiedMs = ctx.statModifiedMs ?? ((path: string) => {
        try { return statSync(path).mtimeMs; } catch { return 0; }
      });

      const hits: string[] = [];
      for (const root of searchRoots) {
        try {
          if (!exists(root)) continue;
          for (const name of listNames(root)) {
            if (!SPEND_FILE_RE.test(name) || !SPEND_EXT_RE.test(name)) continue;
            // Skip test fixtures / mocha output mistaken for spend ledgers.
            if (/test-spend|\.test\.|spec\./i.test(name)) continue;
            hits.push(join(root, name));
          }
          if (root === "/workspace") {
            for (const name of listNames(root)) {
              if (!/xai/i.test(name)) continue;
              const dir = join(root, name);
              try {
                for (const f of listNames(dir)) {
                  if (!SPEND_FILE_RE.test(f) || !SPEND_EXT_RE.test(f)) continue;
                  if (/test-spend|\.test\.|spec\./i.test(f)) continue;
                  hits.push(join(dir, f));
                }
              } catch {
                /* skip */
              }
            }
          }
        } catch {
          /* skip root */
        }
      }

      if (!hits.length) {
        return { ok: false, reason: NO_SPEND_SOURCE };
      }

      const all = [];
      let droppedInvalid = 0;
      const used: string[] = [];
      // Roots can overlap. Select unique files deterministically by freshness,
      // rather than letting filesystem enumeration hide the newest ledger.
      const candidates = [...new Set(hits)].map((path) => {
        let modifiedMs = 0;
        try { modifiedMs = statModifiedMs(path); } catch { /* unreadable */ }
        return { path, modifiedMs: Number.isFinite(modifiedMs) ? modifiedMs : 0 };
      }).sort((a, b) => b.modifiedMs - a.modifiedMs || a.path.localeCompare(b.path));
      for (const { path } of candidates.slice(0, MAX_SPEND_FILES)) {
        try {
          if (statSize(path) > MAX_FILE_BYTES) {
            droppedInvalid += 1;
            continue;
          }
          const text = readText(path);
          const parsed = parseSpendFileText(text, path, nowMs);
          droppedInvalid += parsed.droppedInvalid;
          if (parsed.events.length) {
            all.push(...parsed.events);
            used.push(path);
          }
        } catch {
          droppedInvalid += 1;
        }
      }

      if (!all.length) {
        return { ok: false, reason: NO_SPEND_SOURCE, droppedInvalid };
      }

      all.sort((a, b) => b.atMs - a.atMs);
      const events = all.slice(0, MAX_EVENTS);
      const omitted = Math.max(0, candidates.length - MAX_SPEND_FILES);
      const coverage = `${used.length} readable source(s); ${omitted} older source(s) outside the ${MAX_SPEND_FILES}-file limit${all.length > MAX_EVENTS ? `; newest ${MAX_EVENTS} events retained` : ""}. Observed logs may not include all provider charges.`;
      return { ok: true, events, source: used.join(" · "), droppedInvalid, coverage };
    },
  };
}

export function loadMoneyView(
  env: { nowMs?: number; adapter?: SpendAdapter } = {},
): MoneyView {
  const adapter = env.adapter ?? createFilesystemSpendAdapter();
  const loadResult = adapter.load({ nowMs: env.nowMs });
  return buildMoneyView({ loadResult, nowMs: env.nowMs });
}
