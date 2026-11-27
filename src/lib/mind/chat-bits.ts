export const gallery = [
  { id: "pip", name: "Pip", description: "A blue robot with a signal light." },
  { id: "dewy", name: "Dewy", description: "A quiet water droplet." },
  { id: "ember", name: "Fireball", description: "A small flame with a golden center." },
  { id: "hoots", name: "Hoots", description: "An amber owl with watchful eyes." },
  { id: "rocky", name: "Rocky", description: "A silver pebble with sturdy feet." },
  { id: "seedy", name: "Seedy", description: "A two-leaf sprout." },
  { id: "stacky", name: "Stacky", description: "A tower of lavender blocks." },
] as const;
export const BITS_KEY = "mind.chat-bits.v1";
export type BitPreferences = { selected: string; image: string; name: string; visible: boolean; desktop: boolean; corner: "left" | "right"; chat: string };
export const defaultBits: BitPreferences = { selected: "pip", image: "", name: "", visible: false, desktop: false, corner: "right", chat: "" };
export function readBits(raw: string | null): BitPreferences {
  try {
    const value = JSON.parse(raw || "{}");
    const image = typeof value.image === "string" && value.image.length < 800000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.image) ? value.image : "";
    return { selected: (value.selected === "custom" && image) || gallery.some((bit) => bit.id === value.selected) ? value.selected : "pip",
      image, name: String(value.name || "My companion").slice(0, 50), visible: value.visible === true, desktop: value.desktop === true,
      corner: value.corner === "left" ? "left" : "right", chat: typeof value.chat === "string" ? value.chat : "" };
  } catch { return defaultBits; }
}
export function bitImage(bits: BitPreferences) {
  return bits.selected === "custom" ? bits.image : `/chat-bits/${bits.selected}.png`;
}
export function bitName(bits: BitPreferences) {
  return gallery.find((pet) => pet.id === bits.selected)?.name || bits.name || "My companion";
}
