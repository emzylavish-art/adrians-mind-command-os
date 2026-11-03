/**
 * Voice commands recognized during dictation.
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

type Pattern = { kind: VoiceCommandKind; re: RegExp };

const PATTERNS: Pattern[] = [
  { kind: "new_paragraph", re: /\b(?:new paragraph|next paragraph)\b/gi },
  { kind: "new_line", re: /\b(?:new line|next line|newline)\b/gi },
  { kind: "question_mark", re: /\b(?:question mark)\b/gi },
  { kind: "exclamation", re: /\b(?:exclamation (?:mark|point)|bang)\b/gi },
  { kind: "period", re: /\b(?:period|full stop)\b/gi },
  { kind: "comma", re: /\b(?:comma)\b/gi },
  { kind: "scratch_that", re: /\b(?:scratch that|forget that|ignore that)\b/gi },
  { kind: "delete_that", re: /\b(?:delete that|undo that)\b/gi },
  { kind: "pause", re: /\b(?:pause dictation|pause)\b/gi },
  { kind: "resume", re: /\b(?:resume dictation|resume|continue dictation)\b/gi },
  { kind: "stop", re: /\b(?:stop dictation|end dictation)\b/gi },
  { kind: "select_all", re: /\b(?:select all)\b/gi },
];

/**
 * Extract voice commands from a finalized (or interim) transcript segment.
 * Commands are removed from the returned text so they are never inserted literally.
 * Order of `commands` follows appearance in the original string.
 */
export function parseVoiceCommands(raw: string): CommandParseResult {
  const source = (raw || "").trim();
  if (!source) return { text: "", commands: [] };

  type Hit = { kind: VoiceCommandKind; matched: string; index: number; length: number };
  const hits: Hit[] = [];
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
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

  // Rebuild text with command spans removed
  let text = "";
  let i = 0;
  for (const hit of chosen) {
    text += source.slice(i, hit.index);
    i = hit.index + hit.length;
  }
  text += source.slice(i);
  text = text.replace(/\s{2,}/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();

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
