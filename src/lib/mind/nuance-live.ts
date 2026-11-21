/** Nuance Live session helpers. The API key never belongs in a browser response. */

export const NUANCE_API_URL = "https://api.nuancelabs.ai";
export const NUANCE_PERSONA_ID = "sonia";
export const NUANCE_PERSONA_NAME = "Sonia";

export const NUANCE_SELECTABLE_PERSONAS = ["sonia", "sam", "mira"] as const;
export type NuancePersonaId = (typeof NUANCE_SELECTABLE_PERSONAS)[number];

export type NuancePersonaChoice = {
  id: string;
  name: string;
  available: boolean;
  reason: string;
};

/** Every persona the API documents, including Emma who cannot be drawn on an API session. */
export const NUANCE_PERSONAS: readonly NuancePersonaChoice[] = [
  { id: "sonia", name: "Sonia", available: true, reason: "Sonia can join an API video call. She is an AI." },
  { id: "sam", name: "Sam", available: true, reason: "Sam can join an API video call. He is an AI." },
  { id: "mira", name: "Mira", available: true, reason: "Mira can join an API video call. She is an AI." },
  {
    id: "emma",
    name: "Emma",
    available: false,
    reason: "Emma is reserved for the Nuance app. API sessions cannot be drawn as Emma.",
  },
];

export function isSelectablePersona(value: string): value is NuancePersonaId {
  return (NUANCE_SELECTABLE_PERSONAS as readonly string[]).includes(value);
}

export function personaName(id: NuancePersonaId): string {
  return NUANCE_PERSONAS.find((item) => item.id === id)?.name ?? "Sonia";
}

export function personaPrompt(id: NuancePersonaId): string {
  const name = personaName(id);
  return [
    `You are ${name}, an AI on a video call inside Adrian OS Intelligence.`,
    `You are not a human. If asked who you are, say you are ${name}, an AI.`,
    "Speak in short plain sentences.",
    "Help with coding questions by talking them through.",
    "Do not claim a file changed.",
    "Do not ask for a password, a card, money, or remote access.",
    "Do not press or clear the emergency stop.",
    "If the owner wants a file changed, tell them to send it to Build.",
  ].join(" ");
}

export const NUANCE_PROMPT = personaPrompt("sonia");

const KEY_SHAPE = /^nk_[A-Za-z0-9_-]{20,200}$/;
const TOKEN_SHAPE = /^st_[A-Za-z0-9_-]{8,300}$/;
const USER_SHAPE = /^owner-[a-f0-9]{32}$/;
const CONVERSATION_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNuanceKey(value: string): boolean {
  return KEY_SHAPE.test(value);
}

export function isSessionToken(value: string): boolean {
  return TOKEN_SHAPE.test(value);
}

export function isConversationId(value: string): boolean {
  return CONVERSATION_SHAPE.test(value);
}

export function endUserIdFromHash(hex: string): string {
  const id = `owner-${hex.slice(0, 32)}`;
  if (!USER_SHAPE.test(id)) throw new Error("end user id is not safe");
  return id;
}

export function sessionRequest(endUserId: string, camera: boolean, personaId: NuancePersonaId = "sonia") {
  if (!USER_SHAPE.test(endUserId)) throw new Error("end user id is not safe");
  if (!isSelectablePersona(personaId)) throw new Error("persona is not on the API");
  return {
    interface: "nuance_live",
    personality: {
      persona_id: personaId,
      system_prompt: personaPrompt(personaId),
    },
    interface_setup: {
      video: { input: { camera } },
      runtime_tools: { end_call: true },
    },
    end_user_id: endUserId,
    expressiveness: 1,
  };
}

export function redactSecrets(text: string): string {
  return text
    .replace(/nk_[A-Za-z0-9_-]+/g, "[key]")
    .replace(/st_[A-Za-z0-9_-]+/g, "[token]");
}

export function publicNuanceError(status: number, body: string): string {
  const text = redactSecrets(body);
  if (text.includes("reserved_persona")) {
    return "Emma is reserved for the Nuance app. API sessions cannot use that face. Nothing was started.";
  }
  if (text.includes("unknown_persona")) {
    return "That persona is not on the Nuance API. Sonia, Sam, and Mira can be used. Nothing was started.";
  }
  if (status === 401) return "The Nuance key was refused. Nothing was started.";
  if (status === 403 && text.includes("legal_required")) {
    return "Nuance still needs the developer agreement accepted on their platform. Nothing was started.";
  }
  if (status === 403 && text.includes("legal_blocked")) {
    return "Nuance is not offered in this region. Nothing was started.";
  }
  if (status === 409) return "A video call is already open. Nothing new was started.";
  if (status === 429 && (text.includes("credits_spent") || text.includes("start_limit"))) {
    return "Nuance credits or the hourly start limit are used up. Nothing was started.";
  }
  if (status === 429) return "Nuance has no free capacity right now. Nothing was started.";
  return "The video call could not start. Nothing was started.";
}

export function publicPersonaRefusal(personaId: string): string {
  if (personaId === "emma") {
    return "Emma is reserved for the Nuance app. API sessions cannot use that face. Nothing was started.";
  }
  return "That persona is not on the Nuance API. Sonia, Sam, and Mira can be used. Nothing was started.";
}

export type MintResult =
  | { ok: true; token: string }
  | { ok: false; error: string; status: number };

export async function mintNuanceSession(input: {
  key: string;
  endUserId: string;
  camera: boolean;
  personaId?: NuancePersonaId;
  fetchImpl?: typeof fetch;
  apiUrl?: string;
}): Promise<MintResult> {
  if (!isNuanceKey(input.key)) {
    return { ok: false, error: "A Nuance key is not saved on this computer.", status: 409 };
  }
  const personaId = input.personaId ?? "sonia";
  if (!isSelectablePersona(personaId)) {
    return { ok: false, error: publicPersonaRefusal(personaId), status: 400 };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${input.apiUrl ?? NUANCE_API_URL}/session-tokens`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(sessionRequest(input.endUserId, input.camera, personaId)),
    });
  } catch {
    return { ok: false, error: "Nuance could not be reached. Nothing was started.", status: 502 };
  }
  const raw = await response.text();
  if (!response.ok) return { ok: false, error: publicNuanceError(response.status, raw), status: response.status };
  let token = "";
  try {
    const parsed = JSON.parse(raw) as { token?: unknown };
    token = typeof parsed.token === "string" ? parsed.token : "";
  } catch {
    token = "";
  }
  if (!isSessionToken(token)) {
    return { ok: false, error: "Nuance did not return a session. Nothing was started.", status: 502 };
  }
  return { ok: true, token };
}

export function activeConversationIds(body: string): string[] {
  const text = redactSecrets(body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const items = parsed && typeof parsed === "object" && "items" in parsed
    ? (parsed as { items?: unknown }).items
    : null;
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (item && typeof item === "object" && "id" in item ? String((item as { id?: unknown }).id ?? "") : ""))
    .filter((id) => isConversationId(id));
}
