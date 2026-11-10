export type VisemeId = "rest" | "aa" | "ee" | "oo" | "mm";

export type VisemeCue = { id: VisemeId; at: number; until: number };

/** Map one letter to a mouth shape. This is timing data, not a random animation. */
export function visemeForLetter(letter: string): VisemeId {
  const c = letter.toLowerCase();
  if (c === "m" || c === "b" || c === "p" || c === "f" || c === "v") return "mm";
  if (c === "o" || c === "u" || c === "w") return "oo";
  if (c === "e" || c === "i" || c === "y") return "ee";
  if (c === "a") return "aa";
  return "rest";
}

/**
 * Spread the spoken letters across the real audio duration.
 * The last slice returns to rest so the mouth is closed when speech ends.
 */
export function planVisemes(text: string, durationMs: number): VisemeCue[] {
  const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  const letters = [...text].filter((letter) => /[a-z]/i.test(letter));
  if (!letters.length || safeDuration === 0) {
    return [{ id: "rest", at: 0, until: safeDuration }];
  }
  const slice = safeDuration / letters.length;
  const cues: VisemeCue[] = letters.map((letter, index) => ({
    id: visemeForLetter(letter),
    at: index * slice,
    until: (index + 1) * slice,
  }));
  const tail = Math.min(90, safeDuration * 0.08);
  const last = cues[cues.length - 1]!;
  if (last.until - last.at > tail) {
    last.until -= tail;
    cues.push({ id: "rest", at: last.until, until: safeDuration });
  }
  return cues;
}

export function visemeAt(cues: VisemeCue[], timeMs: number): VisemeId {
  if (!cues.length || timeMs < 0) return "rest";
  if (timeMs >= cues[cues.length - 1]!.until) return "rest";
  return cues.find((cue) => timeMs >= cue.at && timeMs < cue.until)?.id ?? "rest";
}
