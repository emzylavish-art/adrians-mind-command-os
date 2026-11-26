import type { Chat, ChatContextPolicy } from "../types.ts";

const keys = ["history", "botKnowledge", "projectDocuments", "projectConversations", "research", "saveMemories"] as const;
export function normalizeContextPolicy(raw: unknown): ChatContextPolicy | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const result = Object.fromEntries(keys.filter((key) => typeof source[key] === "boolean").map((key) => [key, source[key]]));
  return Object.keys(result).length ? result : undefined;
}

export function effectiveContextPolicy(chat: Pick<Chat, "memory" | "temporary" | "contextPolicy">): Required<ChatContextPolicy> {
  const saved = normalizeContextPolicy(chat.contextPolicy);
  return {
    history: saved?.history !== false,
    botKnowledge: saved?.botKnowledge !== false,
    projectDocuments: !chat.temporary && saved?.projectDocuments === true,
    projectConversations: !chat.temporary && saved?.projectConversations === true,
    research: !chat.temporary && saved?.research === true,
    saveMemories: !chat.temporary && chat.memory === "on" && saved?.saveMemories !== false,
  };
}

export function freshContextPolicy(): ChatContextPolicy {
  return { history: false, botKnowledge: false, projectDocuments: false, projectConversations: false, research: false, saveMemories: false };
}

/** Read-only summary for the request preview. Ordinary memory-off still keeps chat history. */
export function contextDisclosure(chat: Pick<Chat, "memory" | "temporary" | "contextPolicy">): string {
  const policy = effectiveContextPolicy(chat);
  return `Saved memories: ${chat.memory === "on" && !chat.temporary ? "on" : "off"}. Conversation history: ${policy.history ? "on" : "off"}. Bot knowledge: ${policy.botKnowledge ? "on" : "off"}. Project documents: ${policy.projectDocuments ? "on" : "off"}. New memory saves: ${policy.saveMemories ? "on" : "off"}.`;
}
