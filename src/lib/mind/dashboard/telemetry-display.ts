import type { PollState } from "./status-poll.ts";
import type { BotNode } from "./types.ts";

export function telemetryDisplay(state: PollState<unknown>, refreshing: boolean) {
  if (state.status === "error") return { tone: "error" as const, label: refreshing ? "Retrying development telemetry" : "Development telemetry unavailable" };
  if (state.status === "loading") return { tone: "pending" as const, label: "Loading development telemetry" };
  if (state.stale) return { tone: "stale" as const, label: refreshing ? "Retrying; showing last good snapshot" : "Showing last good development snapshot" };
  return { tone: "current" as const, label: refreshing ? "Refreshing development telemetry" : "Development snapshot received" };
}

/** Selected detail always resolves against the latest snapshot, never a stored object. */
export function selectedBotFromSnapshot(bots: readonly BotNode[], id: string | null): BotNode | null {
  return id ? bots.find(bot => bot.id === id) ?? null : null;
}
