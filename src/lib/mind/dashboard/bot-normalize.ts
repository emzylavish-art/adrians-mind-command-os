/**
 * Gap #18/#20/#30 — strip bidi controls from bot names; neutralize HTML/script in
 * branch/notes; dedupe bots by id (keep newest activity).
 */
import type { BotNode } from "./types.ts";

const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/g;
const TAG_RE = /<[^>]*>/g;
const JS_RE = /javascript\s*:/gi;
const ON_HANDLER_RE = /\bon[a-z]+\s*=/gi;

export function stripBidiControls(s: string): string {
  return String(s ?? "").replace(BIDI_RE, "");
}

/** Neutralize HTML/script payloads while keeping readable plain text. */
export function sanitizeHostileText(raw: unknown, max = 240): string {
  let s = stripBidiControls(String(raw ?? ""));
  s = s.replace(TAG_RE, "");
  s = s.replace(JS_RE, "");
  s = s.replace(ON_HANDLER_RE, "");
  s = s.replace(/[<>]/g, "");
  if (s.length > max) s = s.slice(0, max);
  return s;
}

export function sanitizeBotDisplayName(name: unknown): string {
  return sanitizeHostileText(name, 160);
}

export function sanitizeBranchLabel(branch: unknown): string {
  return sanitizeHostileText(branch, 120);
}

function activityMs(bot: BotNode): number {
  const t = bot.lastActivityAt ? Date.parse(bot.lastActivityAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Keep first-seen order of unique ids; prefer newer lastActivityAt on collision. */
export function dedupeBotsById(bots: readonly BotNode[]): BotNode[] {
  const map = new Map<string, BotNode>();
  const order: string[] = [];
  for (const raw of bots) {
    if (!raw || typeof raw.id !== "string" || !raw.id) continue;
    const lock = raw.lock
      ? {
          ...raw.lock,
          branch: raw.lock.branch != null ? sanitizeBranchLabel(raw.lock.branch) : null,
          notes: sanitizeHostileText(raw.lock.notes || "", 400),
          // raw already stripped by publicize; keep defensive
        }
      : null;
    const bot: BotNode = {
      ...raw,
      name: sanitizeBotDisplayName(raw.name),
      branch: raw.branch != null ? sanitizeBranchLabel(raw.branch) : null,
      notes: sanitizeHostileText(raw.notes || "", 400),
      reason: sanitizeHostileText(raw.reason || "", 240),
      lock,
    };
    const prev = map.get(bot.id);
    if (!prev) {
      map.set(bot.id, bot);
      order.push(bot.id);
      continue;
    }
    if (activityMs(bot) >= activityMs(prev)) map.set(bot.id, bot);
  }
  return order.map((id) => map.get(id)!);
}
