export type ReplyAction = "copy" | "read-aloud" | "stop-playback" | "regenerate" | "stop-generating" | "sources" | "feedback" | "more";

export function replyActions(input: { role: "user" | "assistant"; busy: boolean; speaking: boolean; hasSources: boolean }): ReplyAction[] {
  if (input.role !== "assistant") return ["copy"];
  const primary: ReplyAction[] = ["copy", input.speaking ? "stop-playback" : "read-aloud", input.busy ? "stop-generating" : "regenerate"];
  const secondary: ReplyAction[] = [];
  if (input.hasSources) secondary.push("sources");
  secondary.push("feedback", "more");
  return [...primary, ...secondary];
}

export function replyHasSources(text: string): boolean {
  if (/no citations were created/i.test(text)) return false;
  return /https?:\/\/\S+/i.test(text);
}
