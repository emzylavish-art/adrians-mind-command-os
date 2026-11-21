export const TALKING_HEAD_SOURCE = "https://github.com/met4citizen/TalkingHead";
export const TALKING_HEAD_AVATAR = "/vendor/talkinghead/brunette.glb";

export function talkingHeadView(framing: string): "full" | "mid" | "upper" | "head" {
  if (framing === "full") return "full";
  if (framing === "upper") return "mid";
  if (framing === "face" || framing === "compact") return "head";
  return "upper";
}
