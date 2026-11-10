import type { MindCharacter } from "../characters/index.ts";
import type { AvatarExpression, AvatarPresence } from "./presence.ts";
import { expressionForPresence, plateForExpression } from "./presence.ts";
import { planVisemes, visemeAt, type VisemeId } from "./visemes.ts";

export type SpeechClock = { playing: boolean; current: number; duration: number };

export function speechFrame(
  presence: AvatarPresence,
  utterance: string,
  startedAt: number | null,
  clock: SpeechClock,
  now: number,
): { speaking: boolean; viseme: VisemeId } {
  const audioKnown = clock.playing && clock.duration > 0;
  const estimated = Math.max(500, utterance.length * 55);
  const elapsed = startedAt ? now - startedAt : 0;
  const speaking = presence === "speaking" && (audioKnown || clock.playing || (elapsed >= 0 && elapsed < estimated));
  const durationMs = audioKnown ? clock.duration * 1000 : estimated;
  const timeMs = audioKnown ? clock.current * 1000 : elapsed;
  return {
    speaking,
    viseme: speaking ? visemeAt(planVisemes(utterance, durationMs), timeMs) : "rest",
  };
}

export function selectFaceSrc(
  character: MindCharacter,
  presence: AvatarPresence,
  expression: AvatarExpression | null,
  viseme: VisemeId,
  speaking: boolean,
): string {
  if (speaking && viseme !== "rest") return character.visemes[viseme] ?? character.visemes.aa ?? character.portrait;
  const plate = plateForExpression(expression ?? expressionForPresence(speaking ? "speaking" : presence));
  if (plate === "speaking" || plate === "neutral") return character.portrait;
  return character.expressions[plate] ?? character.portrait;
}
