export type AvatarPresence =
  | "idle"
  | "listening"
  | "processing"
  | "speaking"
  | "interrupted"
  | "waiting_approval"
  | "executing"
  | "completed"
  | "error"
  | "offline";

export type AvatarExpression =
  | "neutral"
  | "listening"
  | "speaking"
  | "smiling"
  | "laughing"
  | "curious"
  | "surprised"
  | "concerned"
  | "thoughtful"
  | "serious"
  | "confident"
  | "supportive"
  | "sad"
  | "excited";

export type AvatarFraming = "full" | "upper" | "face" | "compact";

export const AVATAR_EXPRESSIONS: AvatarExpression[] = [
  "neutral",
  "listening",
  "speaking",
  "smiling",
  "laughing",
  "curious",
  "surprised",
  "concerned",
  "thoughtful",
  "serious",
  "confident",
  "supportive",
  "sad",
  "excited",
];

export function expressionForPresence(presence: AvatarPresence): AvatarExpression {
  switch (presence) {
    case "listening":
      return "listening";
    case "processing":
    case "executing":
      return "thoughtful";
    case "speaking":
      return "speaking";
    case "waiting_approval":
      return "serious";
    case "completed":
      return "smiling";
    case "error":
      return "concerned";
    case "offline":
      return "serious";
    default:
      return "neutral";
  }
}

/** Plates we actually have. Missing plates fall back; they are not invented at draw time. */
export function plateForExpression(expression: AvatarExpression): "neutral" | "listening" | "thoughtful" | "concerned" | "smiling" | "speaking" {
  switch (expression) {
    case "listening":
    case "curious":
    case "surprised":
      return "listening";
    case "thoughtful":
    case "serious":
    case "confident":
      return "thoughtful";
    case "concerned":
    case "sad":
      return "concerned";
    case "smiling":
    case "laughing":
    case "excited":
    case "supportive":
      return "smiling";
    case "speaking":
      return "speaking";
    default:
      return "neutral";
  }
}

export function isAvatarFraming(value: unknown): value is AvatarFraming {
  return value === "full" || value === "upper" || value === "face" || value === "compact";
}
