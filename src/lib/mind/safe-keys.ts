/** Capability-scoped Safe Keys inventory. No provider credentials or secret values are represented here. */
export const SAFE_KEY_CAPABILITIES = [
  { id: "voice", name: "Voice" },
  { id: "chat", name: "Chat" },
  { id: "image", name: "Image" },
  { id: "video", name: "Video" },
  { id: "code", name: "Code" },
  { id: "gpt", name: "GPT" },
];

export function safeKeyStatus(
  capabilityId: string,
  configured: Record<string, boolean> = {},
): string {
  if (capabilityId === "gpt" || capabilityId === "chat") {
    return configured.openai
      ? "Configured — key hidden"
      : "Missing — OpenAI key is not configured";
  }
  return "Not connected — configuration unavailable";
}

/** Backward-compatible fallback when a caller has not selected a capability. */
export const SAFE_KEY_STATUS = "Not connected — configuration unavailable";
