/** Pure helpers for persisting voice-mode turns into the chat thread. */

export type VoiceChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  model?: string;
};

export function buildVoiceChatTurn(input: {
  userText: string;
  assistantText: string;
  model?: string;
  nowIso?: string;
  idFactory?: () => string;
}): { user: VoiceChatMessage; assistant: VoiceChatMessage } | null {
  const userText = input.userText.trim();
  const assistantText = input.assistantText.trim();
  if (!userText || !assistantText) return null;
  const at = input.nowIso ?? new Date().toISOString();
  const id = input.idFactory ?? (() => crypto.randomUUID());
  return {
    user: { id: id(), role: "user", content: userText, at },
    assistant: {
      id: id(),
      role: "assistant",
      content: assistantText,
      at,
      model: input.model ?? "voice-direct",
    },
  };
}

/** PCM16 mono duration from raw byte length. */
export function pcm16MonoDurationMs(byteLength: number, sampleRate: number): number {
  if (byteLength <= 0 || sampleRate <= 0) return 0;
  const samples = Math.floor(byteLength / 2);
  return Math.round((samples / sampleRate) * 1000);
}
