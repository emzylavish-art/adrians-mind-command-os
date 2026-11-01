export function relevantMemories(items: { id: string; text: string; archived?: boolean }[], query: string) {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
  if (words.length === 0) return [];
  return items.filter((item) => !item.archived && words.some((word) => item.text.toLowerCase().includes(word))).slice(0, 5);
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
