/**
 * Turn-result memory-save signal for the in-thread indicator.
 * Pure helper — does not call a model or rebuild memory rules.
 */
export type TurnMemorySignal = {
  memorySaved: boolean;
  savedMemoryId: string | null;
};

export function emptyMemorySignal(): TurnMemorySignal {
  return { memorySaved: false, savedMemoryId: null };
}

export function memorySignalFromSave(
  saved: { ok: true; id: string } | { ok: false },
): TurnMemorySignal {
  if (!saved.ok) return emptyMemorySignal();
  return { memorySaved: true, savedMemoryId: saved.id };
}

/** Decide whether a turn body may persist a note (requires memory ON + non-empty text). */
export function shouldPersistTurnMemory(input: {
  memory: "off" | "on";
  saveText?: string | null;
}): boolean {
  if (input.memory !== "on") return false;
  const text = typeof input.saveText === "string" ? input.saveText.trim() : "";
  return text.length > 0;
}
