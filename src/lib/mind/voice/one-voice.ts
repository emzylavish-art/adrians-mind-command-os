/** One spoken reply uses one output. A live call is not spoken again as model audio. */

export type ReplyVoice = "live" | "call" | "model";

export function replyVoiceForTurn(input: {
  liveSessionOpen: boolean;
  mode: "direct" | "orchestrator";
  placingCall: boolean;
}): ReplyVoice {
  if (input.placingCall) return "call";
  if (input.liveSessionOpen && input.mode !== "orchestrator") return "live";
  return "model";
}

export function shouldSpeakTranscriptAgain(voice: ReplyVoice): boolean {
  return voice === "model";
}
