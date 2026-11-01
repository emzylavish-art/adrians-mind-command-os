import type { Chat, MemoryItem, Workspace } from "../types.ts";
import { memoriesForChat } from "../workspace.ts";
import { assembleTurn } from "../prompt.ts";

/** Per-chat "don't use memory" — honored wherever notes are injected into the prompt. */
export function memoryInjectionAllowed(memory: Chat["memory"] | "off" | "on"): boolean {
  return memory === "on";
}

/** Notes that would be injected for this chat; empty when the skip flag is on. */
export function injectableMemoriesForChat(ws: Workspace, chat: Chat): MemoryItem[] {
  if (!memoryInjectionAllowed(chat.memory)) return [];
  return memoriesForChat(ws, chat);
}

/**
 * Smallest prompt-path check: when memory is off, context must not reach the model.
 * Returns the assembleTurn error string when injection was refused, else null.
 */
export function promptSkipRefusal(
  memory: "off" | "on",
  memoryContext: { id: string; text: string }[],
): string | null {
  const assembled = assembleTurn({
    memory,
    history: [],
    text: "ping",
    memoryContext,
  });
  if (assembled.ok) return null;
  return assembled.error;
}
