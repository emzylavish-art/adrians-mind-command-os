export type EveProjection = {
  id: string;
  label: string;
  sky: string;
  floor: string;
  note: string;
};

const NAMED = [
  { id: "night", words: ["night", "stars", "space", "moon"], label: "Night sky", sky: "#0b1024", floor: "#070912" },
  { id: "ocean", words: ["ocean", "sea", "water", "beach"], label: "Ocean", sky: "#0e4d66", floor: "#083044" },
  { id: "city", words: ["city", "street", "skyline"], label: "City", sky: "#241428", floor: "#120810" },
  { id: "forest", words: ["forest", "garden", "trees"], label: "Forest", sky: "#143024", floor: "#0c1c14" },
  { id: "code", words: ["code", "computer", "terminal", "build"], label: "Her computer", sky: "#101820", floor: "#0a1014" },
  { id: "studio", words: ["studio", "stage", "warm"], label: "Studio", sky: "#3a241c", floor: "#1c100c" },
  { id: "red", words: ["red"], label: "Red room", sky: "#6a1c1c", floor: "#2a0c0c" },
  { id: "blue", words: ["blue"], label: "Blue room", sky: "#16386a", floor: "#0c1c38" },
  { id: "green", words: ["green"], label: "Green room", sky: "#145032", floor: "#0c2818" },
  { id: "white", words: ["white", "bright"], label: "Bright room", sky: "#d8d2c8", floor: "#8a847c" },
] as const;

const ROOM: EveProjection = {
  id: "room",
  label: "Her room",
  sky: "#101014",
  floor: "#0a0a0c",
  note: "EVE is projecting this on her own computer. Your Windows desktop is not changed.",
};

function scene(id: string, label: string, sky: string, floor: string): EveProjection {
  return { id, label, sky, floor, note: ROOM.note };
}

/** Maps speech to a background immediately. It does not touch another computer. */
export function projectFromSpeech(text: string): EveProjection {
  const lower = text.toLowerCase();
  if (!lower.trim()) return ROOM;
  const named = NAMED.find((item) => item.words.some((word) => lower.includes(word)));
  if (named) return scene(named.id, named.label, named.sky, named.floor);
  const words = lower.replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).slice(-3).join(" ");
  const hue = [...words].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return scene(`live-${words}`, words.slice(0, 42) || "Live", `hsl(${hue} 42% 28%)`, `hsl(${hue} 30% 12%)`);
}
