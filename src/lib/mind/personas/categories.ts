/**
 * Explore categories inspired by Poe Explore evidence (Official, Budget, Search,
 * Image, Video, Audio, Programming, Assistant). Only categories that can be
 * filled from local fleet templates/agents are auto-populated; the rest stay
 * honest empty states — never silent, never fake live bots.
 */

export const PERSONA_CATEGORIES = [
  { id: "official", label: "Official", description: "Built-in agent templates on this device. Not live Poe or Character.AI bots." },
  { id: "assistant", label: "Assistant", description: "General-purpose and productivity agents saved or templated locally." },
  { id: "search", label: "Search", description: "Research agents. Web search still requires a configured provider." },
  { id: "programming", label: "Programming", description: "Coding and browser-operator agents. They do not edit a repository from this page." },
  { id: "image", label: "Image", description: "Content-oriented agents. Image generation APIs are not called from Explore." },
  { id: "video", label: "Video", description: "No local video personas. Video generation is not called." },
  { id: "audio", label: "Audio", description: "No local audio personas. Voice lives on the Chat path, not as Explore bots." },
  { id: "budget", label: "Budget", description: "No pricing tiers here. Mind Command OS does not sell points." },
  { id: "mine", label: "My agents", description: "Agents already saved in this browser workspace." },
] as const;

export type PersonaCategoryId = (typeof PERSONA_CATEGORIES)[number]["id"];

export function isPersonaCategoryId(value: string): value is PersonaCategoryId {
  return PERSONA_CATEGORIES.some((item) => item.id === value);
}

/** Map a fleet role to the closest Explore category. Unknown roles stay on Assistant. */
export function categoryForRole(role: string): PersonaCategoryId {
  const normalized = role.trim().toLowerCase();
  if (normalized === "research") return "search";
  if (normalized === "coding" || normalized === "browser") return "programming";
  if (normalized === "content") return "image";
  if (
    normalized === "assistant" ||
    normalized === "email" ||
    normalized === "manager" ||
    normalized === "documents" ||
    normalized === "data" ||
    normalized === "knowledge" ||
    normalized === "custom" ||
    normalized === "agent"
  ) {
    return "assistant";
  }
  return "assistant";
}
