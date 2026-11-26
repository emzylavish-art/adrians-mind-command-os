export const MAX_CODE_HANDOFF_CHARS = 1_000_000;
const temporaryDrafts = new Map<string, string>();
type HandoffStorage = Pick<Storage, "getItem" | "setItem">;
export function codeDraftScope(ownerId: string | null | undefined, threadId: string, temporary: boolean) {
  return JSON.stringify([ownerId ?? null, threadId, temporary]);
}
export function codeDraftKey(ownerId: string, threadId: string, temporary: boolean) {
  return `amcos.draft.v1.${codeDraftScope(ownerId, threadId, temporary)}.human-code`;
}

/** Confirm the complete destination copy before navigating away from the Build result. */
export function stageCodeHandoff(storage: HandoffStorage | null, ownerId: string, threadId: string, text: string, temporary: boolean): { ok: true; characters: number } | { ok: false; error: string } {
  if (!ownerId || !threadId) return { ok: false, error: "Sign in and choose the destination conversation before handing off code." };
  if (!text.trim() || text.length > MAX_CODE_HANDOFF_CHARS) return { ok: false, error: `The handoff needs 1–${MAX_CODE_HANDOFF_CHARS.toLocaleString("en-US")} characters. The complete Build result remains available; nothing was shortened.` };
  const key = codeDraftKey(ownerId, threadId, temporary);
  if (temporary) { temporaryDrafts.set(key, text); return { ok: true, characters: text.length }; }
  try {
    if (!storage) throw new Error("Browser storage is unavailable.");
    const encoded = JSON.stringify(text);
    storage.setItem(key, encoded);
    if (storage.getItem(key) !== encoded) throw new Error("The destination draft did not read back exactly.");
    return { ok: true, characters: text.length };
  } catch { return { ok: false, error: "The complete handoff could not be saved on this device. The Build result remains available; copy or download it before leaving." }; }
}

export function takeTemporaryCodeHandoff(ownerId: string, threadId: string): string | undefined {
  const key = codeDraftKey(ownerId, threadId, true);
  const text = temporaryDrafts.get(key); temporaryDrafts.delete(key); return text;
}
