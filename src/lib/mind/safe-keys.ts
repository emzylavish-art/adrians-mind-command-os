/** Capability-scoped Safe Keys inventory. No provider credentials or secret values are represented here. */
export const SAFE_KEY_CAPABILITIES = [
  { id: "voice", name: "Voice" },
  { id: "chat", name: "Chat" },
  { id: "image", name: "Image" },
  { id: "video", name: "Video" },
  { id: "code", name: "Code" },
  { id: "gpt", name: "GPT" },
];

/** No authenticated secure-storage status API has been verified, so do not imply configured state. */
export const SAFE_KEY_STATUS = "Not connected — configuration unavailable";
