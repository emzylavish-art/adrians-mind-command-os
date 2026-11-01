import { useState, type ReactNode } from "react";
import { splitBlocks } from "@/lib/mind/blocks";
import { InlineImage } from "@/components/mind/media/inline-image";
import type { MsgImage } from "@/lib/mind/types";

const MD_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function TextWithImages({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(MD_IMAGE.source, "g");
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const alt = match[1] || "image";
    const src = match[2]!;
    if (src.startsWith("data:image/") || /^https?:\/\//i.test(src)) {
      nodes.push(<InlineImage key={`img-${match.index}`} src={src} alt={alt} />);
    } else {
      nodes.push(match[0]);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <p className="whitespace-pre-wrap">{nodes}</p>;
}

export function MessageBody({ text, images }: { text: string; images?: MsgImage[] }) {
  const blocks = splitBlocks(text);
  const [copied, setCopied] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {images?.map((image, index) => (
        <InlineImage key={`attach-${index}`} src={image.dataUrl} alt={image.name || `Attachment ${index + 1}`} />
      ))}
      {blocks.map((block, index) =>
        block.kind === "code" ? (
          <pre key={index} className="overflow-x-auto rounded-panel bg-bg p-3 text-xs">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-muted">{block.lang || "code"}</p>
              <button
                type="button"
                className="min-h-11 text-accent"
                onClick={() => {
                  void navigator.clipboard?.writeText(block.code).then(() => setCopied(index)).catch(() => setCopied(null));
                }}
              >
                {copied === index ? "Copied" : "Copy code"}
              </button>
            </div>
            <code>{block.code}</code>
          </pre>
        ) : (
          <TextWithImages key={index} text={block.text} />
        ),
      )}
    </div>
  );
}
