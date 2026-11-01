/**
 * Gap #18/#20 — strip bidi controls from bot names; dedupe bots by id (keep newest activity).
 */
import type { BotNode } from "./types.ts";

const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/g;

export function stripBidiControls(s: string): string {
  return String(s ?? "").replace(BIDI_RE, "");
}

export function sanitizeBotDisplayName(name: unknown): string {
  return stripBidiControls(String(name ?? "")).slice(0, 160);
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
    const bot: BotNode = {
      ...raw,
      name: sanitizeBotDisplayName(raw.name),
      notes: stripBidiControls(raw.notes || ""),
      reason: stripBidiControls(raw.reason || ""),
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
