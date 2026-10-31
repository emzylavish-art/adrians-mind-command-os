export type Block = { kind: "text"; text: string } | { kind: "code"; lang: string; code: string };

/** Split a reply into text and fenced code. The text is not HTML. */
export function splitBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const parts = source.split("```");
  parts.forEach((part, index) => {
    if (index % 2 === 0) {
      if (part.length > 0) blocks.push({ kind: "text", text: part });
      return;
    }
    const breakAt = part.indexOf("\n");
    if (breakAt === -1) {
      blocks.push({ kind: "code", lang: "", code: part });
      return;
    }
    blocks.push({
      kind: "code",
      lang: part.slice(0, breakAt).trim().slice(0, 24),
      code: part.slice(breakAt + 1).replace(/\n$/, ""),
    });
  });
  return blocks;
}
