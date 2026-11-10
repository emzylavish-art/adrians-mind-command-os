import { isAllowedXaiVoice, type XaiBuiltinVoice } from "../voice/voices.ts";

/**
 * Presentation roster only. Every character uses Adrian Core for reasoning,
 * memory, approvals and the emergency stop. A character cannot grant tools
 * or bypass a halt.
 *
 * Five adult female operators are filled. The roster is sized for ten female
 * and ten male identities; unfilled slots stay empty rather than invented.
 */
export const CHARACTER_CAPACITY = { female: 10, male: 10 } as const;

export type CharacterSex = "female" | "male";

export type MindCharacter = {
  id: string;
  name: string;
  sex: CharacterSex;
  role: string;
  voiceId: XaiBuiltinVoice;
  speakingStyle: string;
  summary: string;
};

export const MIND_CHARACTERS: readonly MindCharacter[] = [
  {
    id: "eve",
    name: "EVE",
    sex: "female",
    role: "Lead operator",
    voiceId: "eve",
    speakingStyle: "Steady, direct and calm. Lead with the operational fact, then the next action.",
    summary: "Primary interface for Adrian Core. Reports real status and does not invent execution.",
  },
  {
    id: "liora",
    name: "Liora",
    sex: "female",
    role: "Analyst",
    voiceId: "liora",
    speakingStyle: "Patient and precise. Separate evidence from inference.",
    summary: "Reads what is already stored and says when a source is missing.",
  },
  {
    id: "iris",
    name: "Iris",
    sex: "female",
    role: "Professional",
    voiceId: "iris",
    speakingStyle: "Businesslike, structured and brief.",
    summary: "Same authority boundary as EVE, with a formal delivery.",
  },
  {
    id: "luna",
    name: "Luna",
    sex: "female",
    role: "Supportive",
    voiceId: "luna",
    speakingStyle: "Warm and plain-spoken. Do not claim to be a clinician.",
    summary: "Supportive delivery only. Does not relax safety or approval rules.",
  },
  {
    id: "aurora",
    name: "Aurora",
    sex: "female",
    role: "Storyteller",
    voiceId: "aurora",
    speakingStyle: "Vivid but factual. Do not dramatise status, timestamps or tool results.",
    summary: "Narrative delivery for explanations. Operational facts stay literal.",
  },
] as const;

export const DEFAULT_CHARACTER_ID = "eve";
export const CHARACTER_STORAGE_KEY = "amcos.character.v1";

const BY_ID = new Map(MIND_CHARACTERS.map((item) => [item.id, item]));

export function characterById(value: unknown): MindCharacter | null {
  if (typeof value !== "string") return null;
  return BY_ID.get(value) ?? null;
}

export function resolveCharacterId(value: unknown): string {
  return characterById(value)?.id ?? DEFAULT_CHARACTER_ID;
}

export function rosterAvailability() {
  const female = MIND_CHARACTERS.filter((item) => item.sex === "female").length;
  const male = MIND_CHARACTERS.filter((item) => item.sex === "male").length;
  return {
    femaleFilled: female,
    femaleOpen: CHARACTER_CAPACITY.female - female,
    maleFilled: male,
    maleOpen: CHARACTER_CAPACITY.male - male,
    sharedBrain: "Adrian Core",
    grantsPermissions: false as const,
  };
}

export function readStoredCharacterId(storage: Pick<Storage, "getItem"> | null | undefined): string {
  try {
    return resolveCharacterId(storage?.getItem(CHARACTER_STORAGE_KEY));
  } catch {
    return DEFAULT_CHARACTER_ID;
  }
}

export function writeStoredCharacterId(
  value: unknown,
  storage: Pick<Storage, "setItem"> | null | undefined,
): MindCharacter {
  const character = characterById(value) ?? characterById(DEFAULT_CHARACTER_ID)!;
  try {
    storage?.setItem(CHARACTER_STORAGE_KEY, character.id);
  } catch {
    /* private mode */
  }
  return character;
}

export function characterVoiceId(value: unknown): XaiBuiltinVoice {
  const voice = characterById(value)?.voiceId ?? "eve";
  return isAllowedXaiVoice(voice) ? voice : "eve";
}
