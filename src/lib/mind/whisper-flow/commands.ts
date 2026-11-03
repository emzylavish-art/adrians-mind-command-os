/**
 * Voice commands recognized during dictation (Adrian's Mind Whisper Flow).
 * Matching phrases are consumed (not inserted as literal text).
 * Never auto-submits; "send"/"submit" are intentionally not command actions.
 */

export type VoiceCommandKind =
  | "new_line"
  | "new_paragraph"
  | "period"
  | "comma"
  | "question_mark"
  | "exclamation"
  | "delete_that"
  | "scratch_that"
  | "pause"
  | "resume"
  | "stop"
  | "select_all";

export type VoiceCommand = {
  kind: VoiceCommandKind;
  /** Raw matched phrase (for UI/debug). */
  matched: string;
};

export type CommandParseResult = {
  /** Remaining spoken text after command phrases are stripped (may be empty). */
  text: string;
  commands: VoiceCommand[];
};

type Pattern = {
  kind: VoiceCommandKind;
  re: RegExp;
  /** When true, only match if the hit is the whole utterance (or trailing command). */
  wholeOrTrailing?: boolean;
};

/**
 * Homophones / compound forms included for ASR variance.
 * Punctuation commands match mid-sentence (Whisper Flow style).
 * Bare pause/resume require whole-utterance or trailing to avoid "please pause the video".
 */
const PATTERNS: Pattern[] = [
  { kind: "new_paragraph", re: /\b(?:new paragraph|next paragraph)\b/gi },
  { kind: "new_line", re: /\b(?:new line|next line|newline|new-line)\b/gi },
  { kind: "question_mark", re: /\b(?:question mark|questionmark|question-mark)\b/gi },
  { kind: "exclamation", re: /\b(?:exclamation (?:mark|point)|exclamationmark|bang)\b/gi },
  { kind: "period", re: /\b(?:period|full stop|full-stop|fullstop)\b/gi },
  { kind: "comma", re: /\b(?:comma)\b/gi },
  // undo that is an alias for delete/scratch undo behavior
  { kind: "scratch_that", re: /\b(?:scratch that|forget that|ignore that|strike that)\b/gi },
  { kind: "delete_that", re: /\b(?:delete that|undo that|undo last)\b/gi },
  { kind: "pause", re: /\b(?:pause dictation)\b/gi },
  { kind: "pause", re: /\bpause\b/gi, wholeOrTrailing: true },
  { kind: "resume", re: /\b(?:resume dictation|continue dictation)\b/gi },
  { kind: "resume", re: /\bresume\b/gi, wholeOrTrailing: true },
  { kind: "stop", re: /\b(?:stop dictation|end dictation)\b/gi },
  { kind: "select_all", re: /\b(?:select all)\b/gi },
];

function isWholeOrTrailing(source: string, index: number, length: number): boolean {
  const before = source.slice(0, index).trim();
  const after = source.slice(index + length).trim();
  // Whole utterance, or only trailing after other words (e.g. "okay pause")
  if (!before && !after) return true;
  if (before && !after) return true;
  return false;
}

/**
 * Extract voice commands from a finalized (or interim) transcript segment.
 * Commands are removed from the returned text so they are never inserted literally.
 * Order of `commands` follows appearance in the original string.
 * Matching is case-insensitive (ASR casing variance).
 */
export function parseVoiceCommands(raw: string): CommandParseResult {
  const source = (raw || "").trim();
  if (!source) return { text: "", commands: [] };

  type Hit = { kind: VoiceCommandKind; matched: string; index: number; length: number };
  const hits: Hit[] = [];
  for (const { kind, re, wholeOrTrailing } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      if (wholeOrTrailing && !isWholeOrTrailing(source, m.index, m[0].length)) continue;
      hits.push({ kind, matched: m[0], index: m.index, length: m[0].length });
    }
  }
  hits.sort((a, b) => a.index - b.index || b.length - a.length);

  // Greedy non-overlapping
  const chosen: Hit[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.index < cursor) continue;
    chosen.push(hit);
    cursor = hit.index + hit.length;
  }

  // Rebuild text with command spans removed (Unicode-letter safe spacing cleanup)
  let text = "";
  let i = 0;
  for (const hit of chosen) {
    text += source.slice(i, hit.index);
    i = hit.index + hit.length;
  }
  text += source.slice(i);
  // Collapse whitespace; tuck Latin/common punctuation against prior token without
  // eating non-Latin letters (multilingual-safe).
  text = text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?;:…¿¡])/g, "$1")
    .trim();

  return {
    text,
    commands: chosen.map((h) => ({ kind: h.kind, matched: h.matched })),
  };
}

/** Map a command to an insertable control character / punctuation (or null if side-effect only). */
export function commandToInsert(kind: VoiceCommandKind): string | null {
  switch (kind) {
    case "new_line":
      return "\n";
    case "new_paragraph":
      return "\n\n";
    case "period":
      return ".";
    case "comma":
      return ",";
    case "question_mark":
      return "?";
    case "exclamation":
      return "!";
    default:
      return null;
  }
}

export function isControlCommand(kind: VoiceCommandKind): boolean {
  return (
    kind === "pause" ||
    kind === "resume" ||
    kind === "stop" ||
    kind === "delete_that" ||
    kind === "scratch_that" ||
    kind === "select_all"
  );
}
