import { useEffect, useRef, useState } from "react";
import { splitBlocks } from "@/lib/mind/blocks";
import { MarkdownProse } from "@/components/mind/markdown-prose";
import { ensurePerfTier } from "@/components/mind/perf-tier-host";
import { copyButtonLabel, type CopyState } from "@/lib/mind/copy-feedback";

export function MessageBody({ text }: { text: string }) {
  const blocks = splitBlocks(text);
  const [copyState, setCopyState] = useState<Record<number, CopyState>>({});
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    ensurePerfTier();
  }, []);

  useEffect(() => {
    return () => {
      for (const t of Object.values(timers.current)) clearTimeout(t);
    };
  }, []);

  const setCopy = (index: number, state: CopyState) => {
    setCopyState((prev) => ({ ...prev, [index]: state }));
    if (timers.current[index]) clearTimeout(timers.current[index]);
    if (state !== "idle") {
      timers.current[index] = setTimeout(() => {
        setCopyState((prev) => ({ ...prev, [index]: "idle" }));
      }, 2000);
    }
  };

  return (
    <div className="space-y-2 message-body">
      {blocks.map((block, index) =>
        block.kind === "code" ? (
          <pre key={index} className="md-code-block overflow-x-auto rounded-panel bg-bg p-3 text-xs">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-muted">{block.lang || "code"}</p>
              <button
                type="button"
                className="min-h-11 text-accent md-copy-btn"
                aria-live="polite"
                onClick={() => {
                  const write = navigator.clipboard?.writeText(block.code);
                  if (!write) {
                    setCopy(index, "failed");
                    return;
                  }
                  void write
                    .then(() => setCopy(index, "copied"))
                    .catch(() => setCopy(index, "failed"));
                }}
              >
                {copyButtonLabel(copyState[index] ?? "idle")}
              </button>
            </div>
            <code>{block.code}</code>
          </pre>
        ) : (
          <MarkdownProse key={index} text={block.text} />
        ),
      )}
    </div>
  );
}

export { copyButtonLabel };
