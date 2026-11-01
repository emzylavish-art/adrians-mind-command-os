/**
 * Queue #7 / Gap #22 — MONEY filesystem adapter (server-only; do not import from client UI).
 * Canonical append path (xAI / providers): /workspace/audit/dashboard-3d/spend.jsonl
 * Never invents USD — empty → "no spend source yet".
 */
import { closeSync, createReadStream, existsSync, openSync, readSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  MAX_EVENTS,
  NO_SPEND_SOURCE,
  buildMoneyView,
  parseSpendFileText,
  parseSpendRecord,
  type MoneyView,
  type SpendAdapter,
  type SpendEvent,
  type SpendLoadContext,
  type SpendLoadResult,
} from "./spend-core.ts";

export * from "./spend-core.ts";

/** Allowlisted ledger the xAI (or other) adapter should append USD events to. */
export const CANONICAL_SPEND_JSONL = "/workspace/audit/dashboard-3d/spend.jsonl";

export const SPEND_FILE_RE = /spend|usage|cost|billing/i;
export const SPEND_EXT_RE = /\.(json|jsonl|ndjson|log|csv)$/i;

const DEFAULT_ROOTS = [
  "/workspace/audit/dashboard-3d",
  "/workspace/.handoff",
  "/workspace/mind-command-os-dashboard/.handoff",
  "/workspace/mind-command-os-xai",
  "/workspace",
];

/** Soft read whole-file cap; larger files use tail bytes. */
export const MAX_FULL_READ_BYTES = 512_000;
/** Tail window for huge JSONL / logs (streaming-friendly). */
export const SPEND_TAIL_BYTES = 512_000;
const MAX_HITS = 8;

export type SpendFsHooks = {
  exists?: (path: string) => boolean;
  listNames?: (dir: string) => string[];
  readText?: (path: string) => string;
  /** Read last `maxBytes` of a file (for huge JSONL). */
  readTailText?: (path: string, maxBytes: number) => string;
  statSize?: (path: string) => number;
};

function defaultReadTailText(path: string, maxBytes: number): string {
  const size = statSync(path).size;
  if (size <= 0) return "";
  if (size <= maxBytes) return readFileSync(path, "utf8");
  const start = size - maxBytes;
  const buf = Buffer.alloc(maxBytes);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buf, 0, maxBytes, start);
  } finally {
    closeSync(fd);
  }
  let text = buf.toString("utf8");
  // Drop leading partial line after mid-file seek
  const nl = text.indexOf("\n");
  if (nl >= 0) text = text.slice(nl + 1);
  return text;
}

/** Parse JSONL/text; drop incomplete final line when `allowPartialTail` and no trailing newline. */
export function parseSpendTextRobust(
  text: string,
  source: string,
  nowMs = Date.now(),
  opts?: { allowPartialTail?: boolean },
): { events: SpendEvent[]; droppedInvalid: number } {
  let body = text;
  if (opts?.allowPartialTail && body.length && !body.endsWith("\n") && !body.endsWith("\r")) {
    const lastNl = Math.max(body.lastIndexOf("\n"), body.lastIndexOf("\r"));
    if (lastNl >= 0) body = body.slice(0, lastNl + 1);
    else body = ""; // single partial line only
  }
  return parseSpendFileText(body, source, nowMs);
}

export function createFilesystemSpendAdapter(opts?: { roots?: string[]; hooks?: SpendFsHooks }): SpendAdapter {
  const roots = opts?.roots ?? DEFAULT_ROOTS;
  const hooks = opts?.hooks ?? {};
  return {
    id: "filesystem-spend",
    load(ctx: SpendLoadContext = {}): SpendLoadResult {
      const nowMs = Number.isFinite(ctx.nowMs) ? (ctx.nowMs as number) : Date.now();
      const exists = hooks.exists ?? ctx.exists ?? existsSync;
      const listNames = hooks.listNames ?? ctx.listNames ?? ((dir: string) => readdirSync(dir));
      const readText = hooks.readText ?? ctx.readText ?? ((path: string) => readFileSync(path, "utf8"));
      const readTail =
        hooks.readTailText ??
        ((path: string, maxBytes: number) => defaultReadTailText(path, maxBytes));
      const statSize =
        hooks.statSize ??
        ctx.statSize ??
        ((path: string) => {
          try {
            return statSync(path).size;
          } catch {
            return 0;
          }
        });
      const searchRoots = ctx.roots ?? roots;

      const hits: string[] = [];
      // Prefer canonical ledger first when present
      if (exists(CANONICAL_SPEND_JSONL)) hits.push(CANONICAL_SPEND_JSONL);

      const consider = (dir: string, name: string) => {
        if (!SPEND_FILE_RE.test(name) || !SPEND_EXT_RE.test(name)) return;
        if (/test-spend|\.test\.|spec\./i.test(name)) return;
        const full = join(dir, name);
        if (full === CANONICAL_SPEND_JSONL) return;
        hits.push(full);
      };

      for (const root of searchRoots) {
        try {
          if (!exists(root)) continue;
          for (const name of listNames(root)) {
            consider(root, name);
            // One-level dive into *xai* dirs under /workspace
            if (root === "/workspace" && /xai/i.test(name)) {
              const dir = join(root, name);
              try {
                for (const f of listNames(dir)) consider(dir, f);
              } catch {
                /* skip */
              }
            }
          }
        } catch {
          /* skip root */
        }
      }

      const uniq = [...new Set(hits)].slice(0, MAX_HITS);
      if (!uniq.length) {
        return { ok: false, reason: NO_SPEND_SOURCE };
      }

      const all: SpendEvent[] = [];
      let droppedInvalid = 0;
      const used: string[] = [];
      for (const path of uniq) {
        try {
          const size = statSize(path);
          if (size <= 0) continue;
          const huge = size > MAX_FULL_READ_BYTES;
          const text = huge ? readTail(path, SPEND_TAIL_BYTES) : readText(path);
          const parsed = parseSpendTextRobust(text, path, nowMs, { allowPartialTail: huge });
          droppedInvalid += parsed.droppedInvalid;
          if (parsed.events.length) {
            all.push(...parsed.events);
            used.push(huge ? `${path}#tail` : path);
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
      return { ok: true, events, source: used.join(" · "), droppedInvalid };
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

/** Async line stream for very large JSONL (optional callers / tests). */
export async function streamSpendJsonl(
  path: string,
  nowMs = Date.now(),
  maxEvents = MAX_EVENTS,
): Promise<{ events: SpendEvent[]; droppedInvalid: number }> {
  const events: SpendEvent[] = [];
  let droppedInvalid = 0;
  if (!existsSync(path)) return { events, droppedInvalid };
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    try {
      const ev = parseSpendRecord(JSON.parse(l), path, nowMs);
      if (!ev) {
        droppedInvalid += 1;
        continue;
      }
      events.push(ev);
      if (events.length > maxEvents * 2) {
        events.sort((a, b) => b.atMs - a.atMs);
        events.length = maxEvents;
      }
    } catch {
      droppedInvalid += 1;
    }
  }
  events.sort((a, b) => b.atMs - a.atMs);
  return { events: events.slice(0, maxEvents), droppedInvalid };
}
