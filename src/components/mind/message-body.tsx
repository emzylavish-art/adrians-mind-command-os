import { useState } from "react";
import { splitBlocks } from "@/lib/mind/blocks";

export function MessageBody({ text }: { text: string }) {
  const blocks = splitBlocks(text);
  const [copied, setCopied] = useState<number | null>(null);
  return (
    <div className="space-y-2">
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
          <p key={index} className="whitespace-pre-wrap">{block.text}</p>
        ),
      )}
    </div>
  );
}
