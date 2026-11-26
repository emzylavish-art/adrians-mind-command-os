/** Conservative application budgets, not claims about an upstream model's advertised window. */
export const MAX_HISTORY_MESSAGES = 200;
export type ContextMessage = { role: string; content: string; images?: unknown[] };
export function contextBudget(provider: string, model?: string | null): number {
  if (provider === "ollama") return 4096;
  if (provider.startsWith("custom:") || (model && /:free$/i.test(model))) return 8192;
  return 16384;
}
export function estimateContextTokens(text: string): number {
  // UTF-8 bytes are a deliberately conservative upper bound for byte-based tokenizers.
  return new TextEncoder().encode(text).byteLength;
}
export function selectContextHistory<T extends ContextMessage>(history: T[], options: {
  provider: string; model?: string | null; reservedText?: string; budget?: number;
}) {
  const budget = options.budget ?? contextBudget(options.provider, options.model);
  let left = Math.max(0, budget - 2048 - estimateContextTokens(options.reservedText ?? ""));
  const selected = new Set<number>();
  const add = (index: number) => {
    if (selected.has(index) || selected.size >= MAX_HISTORY_MESSAGES) return;
    const message = history[index];
    const cost = estimateContextTokens(message.content) + 16;
    if (message.content.length > 8000 || cost > left) return;
    selected.add(index); left -= cost;
  };
  const firstUser = history.findIndex((message) => message.role === "user");
  if (firstUser >= 0) add(firstUser);
  history.forEach((message, index) => {
    if (message.role === "user" && /\b(must|do not|don't|requirement|constraint|never)\b/i.test(message.content)) add(index);
  });
  for (let index = history.length - 1; index >= 0; index--) add(index);
  const indices = [...selected].sort((a, b) => a - b);
  return { history: indices.map((index) => history[index]), includedIndices: indices,
    omittedMessages: history.length - indices.length, budget, estimate: "utf8-upper-bound" as const };
}

export type ContextReceipt = { includedMessages: number; omittedMessages: number; excludedImages: number; unavailableImages?: number; budget: number; savedMemory?: "off" | "on"; memoryNotes?: number; botKnowledge?: boolean; personality?: boolean };
export function contextReceiptNotice(receipt: ContextReceipt): string {
  const parts = [`Conversation context: ${receipt.includedMessages} earlier messages included.`];
  if (receipt.savedMemory) parts.push(receipt.savedMemory === "on" ? `Saved memory retrieval on; ${receipt.memoryNotes ?? 0} notes selected.` : "Saved memory retrieval off. Conversation messages remain separate context.");
  if (receipt.botKnowledge) parts.push("Configured bot knowledge included.");
  if (receipt.personality) parts.push("Selected personality instructions included.");
  if (receipt.omittedMessages) parts.push(`${receipt.omittedMessages} earlier messages excluded by the context budget.`);
  if (receipt.excludedImages) parts.push(`${receipt.excludedImages} earlier images excluded by the image or request-size limit.`);
  if (receipt.unavailableImages) parts.push(`${receipt.unavailableImages} earlier images unavailable. Reattach them for comparison.`);
  return parts.join(" ");
}
