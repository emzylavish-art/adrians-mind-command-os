/** Keyboard movement for the workspace search list. Does not send a message. */

export type PaletteKeyAction =
  | { type: "none" }
  | { type: "move"; index: number }
  | { type: "choose"; index: number }
  | { type: "close" };

export function paletteKeyAction(input: {
  key: string;
  open: boolean;
  count: number;
  index: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): PaletteKeyAction {
  if (!input.open) return { type: "none" };
  if (input.key === "Escape") return { type: "close" };
  if (input.count <= 0) return { type: "none" };

  const current = clampIndex(input.index, input.count);
  if (input.key === "ArrowDown") return { type: "move", index: (current + 1) % input.count };
  if (input.key === "ArrowUp") return { type: "move", index: (current - 1 + input.count) % input.count };
  if (input.key === "Home") return { type: "move", index: 0 };
  if (input.key === "End") return { type: "move", index: input.count - 1 };
  if (input.key === "Enter" && !input.metaKey && !input.ctrlKey && !input.altKey) {
    return { type: "choose", index: current };
  }
  return { type: "none" };
}

function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || index < 0) return 0;
  if (index >= count) return count - 1;
  return index;
}
