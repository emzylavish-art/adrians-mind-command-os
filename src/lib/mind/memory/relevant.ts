type Note = { id: string; text: string; archived?: boolean };

/** Preserve ordinary preferences as fallback; move lexical evidence ahead of unrelated notes. */
export function rankMemories<T extends Note>(items: T[], query: string) {
  const words = new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  return items.filter((item) => !item.archived).map((item) => {
    const terms = new Set(item.text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    let score = 0;
    for (const word of words) if (terms.has(word)) score += word.length;
    return { item, score };
  }).sort((a, b) => b.score - a.score);
}

export function relevantMemories<T extends Note>(items: T[], query: string) {
  return rankMemories(items, query).filter((hit) => hit.score > 0).slice(0, 5).map((hit) => hit.item);
}

export function voiceProviderStatus(voiceKey: string | undefined) {
  return {
    realtime: false as const,
    input: "Browser speech recognition, when the browser has it. This is not a realtime voice session.",
    output: voiceKey ? "A speech key is set. This check did not play audio." : "No speech key is configured. Nothing is spoken.",
  };
}

export function safeToResume(entries: { action: string; target: string; at: string; result: string }[], toolId: string, at: string) {
  return !entries.some((entry) => entry.action === "agent_turn" && entry.target === toolId && entry.at >= at && entry.result.includes("completed"));
}
