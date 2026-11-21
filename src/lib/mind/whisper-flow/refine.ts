/**
 * Deterministic local dictation refinement.
 * Runs after a segment is finalized. Never invents meaning; only cleanup + self-corrections.
 * Optional LLM refinement is separate and must not block insertion.
 */

const FILLERS = [
  "um",
  "uh",
  "uhm",
  "erm",
  "ah",
  "eh",
  "like",
  "you know",
  "i mean",
  "sort of",
  "kind of",
];

/** Phrases that discard the current segment (and optionally prior). */
const SCRATCH_SEGMENT = [
  /^\s*(scratch that|forget that|ignore that|delete that)\s*[.!]?\s*$/i,
  /^\s*(no,?\s*i mean|wait,?\s*no|actually,?\s*no)\s*[.!]?\s*$/i,
];

export type RefineResult = {
  text: string;
  /** True when the whole segment should be discarded (scratch that). */
  discardSegment: boolean;
  /** True when the previous committed segment should also be undone. */
  undoPrevious: boolean;
  fillersRemoved: number;
  capitalized: boolean;
  punctuated: boolean;
};

function stripFillers(input: string): { text: string; removed: number } {
  let text = input;
  let removed = 0;
  // Multi-word fillers first
  const multi = ["you know", "i mean", "sort of", "kind of"];
  for (const f of multi) {
    const re = new RegExp(`(^|\\s)${f}(?=\\s|[,.!?;:]|$)`, "gi");
    text = text.replace(re, (_m, lead: string) => {
      removed += 1;
      return lead;
    });
  }
  for (const f of ["um", "uh", "uhm", "erm", "ah", "eh", "like"]) {
    const re = new RegExp(`(^|\\s)${f}(?=\\s|[,.!?;:]|$)`, "gi");
    text = text.replace(re, (_m, lead: string) => {
      removed += 1;
      return lead;
    });
  }
  text = text.replace(/\s{2,}/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
  return { text, removed };
}

/** Apply "no, I mean X" → keep only X when mid-segment. */
function applySelfCorrections(input: string): { text: string; undoPrevious: boolean; discardSegment: boolean } {
  const trimmed = input.trim();
  for (const re of SCRATCH_SEGMENT) {
    if (re.test(trimmed)) {
      return { text: "", undoPrevious: true, discardSegment: true };
    }
  }

  // "… scratch that …" mid-utterance: keep text after the last scratch marker.
  const scratchSplit = /\b(?:scratch that|forget that|ignore that|delete that)\b[,.]?\s*/gi;
  if (scratchSplit.test(trimmed)) {
    const parts = trimmed.split(scratchSplit);
    const last = (parts[parts.length - 1] || "").trim();
    if (!last) return { text: "", undoPrevious: true, discardSegment: true };
    return { text: last, undoPrevious: parts.length > 1, discardSegment: false };
  }

  // "no, I mean X" / "wait, no, X"
  const noMean = /^(?:.*?\b)?(?:no,?\s*i mean|wait,?\s*no,?|actually,?\s*)\s+(.+)$/i;
  const m = trimmed.match(noMean);
  if (m?.[1]) {
    return { text: m[1].trim(), undoPrevious: false, discardSegment: false };
  }
  return { text: trimmed, undoPrevious: false, discardSegment: false };
}

function capitalizeSentenceStarts(input: string): { text: string; changed: boolean } {
  if (!input) return { text: input, changed: false };
  let changed = false;
  const text = input.replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead: string, ch: string) => {
    changed = true;
    return `${lead}${ch.toUpperCase()}`;
  });
  // First char
  if (/^[a-z]/.test(text)) {
    changed = true;
    return { text: text.charAt(0).toUpperCase() + text.slice(1), changed };
  }
  return { text, changed };
}

function ensureTerminalPunctuation(input: string): { text: string; changed: boolean } {
  const t = input.trim();
  if (!t) return { text: t, changed: false };
  if (/[.!?]$/.test(t)) return { text: t, changed: false };
  // Questions
  if (/^(who|what|when|where|why|how|is|are|do|does|did|can|could|would|will|should)\b/i.test(t)) {
    return { text: `${t}?`, changed: true };
  }
  return { text: `${t}.`, changed: true };
}

/**
 * Local deterministic refinement. Safe to run synchronously before insert.
 */
export function refineDictationLocal(raw: string, options?: { addPunctuation?: boolean }): RefineResult {
  const addPunctuation = options?.addPunctuation !== false;
  const corrected = applySelfCorrections(raw);
  if (corrected.discardSegment) {
    return {
      text: "",
      discardSegment: true,
      undoPrevious: corrected.undoPrevious,
      fillersRemoved: 0,
      capitalized: false,
      punctuated: false,
    };
  }
  const fillers = stripFillers(corrected.text);
  let text = fillers.text;
  const cap = capitalizeSentenceStarts(text);
  text = cap.text;
  let punctuated = false;
  if (addPunctuation && text) {
    const p = ensureTerminalPunctuation(text);
    text = p.text;
    punctuated = p.changed;
  }
  return {
    text,
    discardSegment: false,
    undoPrevious: corrected.undoPrevious,
    fillersRemoved: fillers.removed,
    capitalized: cap.changed,
    punctuated,
  };
}

export function fillersListForTests(): readonly string[] {
  return FILLERS;
}
