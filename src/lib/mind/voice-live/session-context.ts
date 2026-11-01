/** Internal prompts for frames/attachments — never shown in Ask Anything. */
export const LIVE_SCREEN_FRAME_PROMPT =
  "(Live screen frame received — describe if relevant.)";

export function attachedImagePrompt(caption: string): string {
  return `(Attached image) ${caption.trim()}`;
}

export function isInternalSessionPrompt(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t === LIVE_SCREEN_FRAME_PROMPT) return true;
  if (t.startsWith("(Live screen frame received")) return true;
  if (t.startsWith("(Attached image)")) return true;
  if (t.startsWith("(Camera snapshot")) return true;
  if (t.startsWith("Vision summary:")) return true;
  if (t.startsWith("Describe this attached image")) return true;
  return false;
}
