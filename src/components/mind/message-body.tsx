import { useState, type ReactNode } from "react";
import { splitBlocks } from "@/lib/mind/blocks";
import { InlineImage } from "@/components/mind/media/inline-image";
import { MarkdownProse } from "@/components/mind/markdown-prose";
import { isSafeImageSrc, sanitizeMediaLabel } from "@/lib/mind/media";
import type { MsgImage } from "@/lib/mind/types";
import {
  CopyCodeFailureBanner,
  onceRetry,
  resolveClipboardWriter,
  runCopyCode,
  snapshotCopyCodeParams,
  type CopyCodeState,
} from "@/lib/mind/copy-code-action";

function stripDangerousMarkup(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/<(?:iframe|object|embed|svg|math)[\s\S]*?>/gi, "");
}

const MD_IMAGE = /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"\n]*")?\)/g;
const HAS_MARKDOWN_IMAGE = /!\[[^\]]*\]\([^)\s]+/;

function TextWithImages({
  text,
  onEditImagine,
  onSaveImage,
  onDownloadImage,
  onUseAsAgentInput,
}: {
  text: string;
  onEditImagine?: (src: string) => void;
  onSaveImage?: (src: string, alt: string) => void;
  onDownloadImage?: (src: string, alt: string) => void;
  onUseAsAgentInput?: (src: string, alt: string) => void;
}) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(MD_IMAGE.source, "g");
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const alt = match[1] || "image";
    const src = match[2]!;
    if (isSafeImageSrc(src)) {
      nodes.push(
        <InlineImage
          key={`img-${match.index}`}
          src={src}
          alt={sanitizeMediaLabel(alt) || "image"}
          onEditImagine={src.startsWith("data:image/") ? onEditImagine : undefined}
          onSave={onSaveImage}
          onDownload={onDownloadImage}
          onUseAsAgentInput={onUseAsAgentInput}
        />,
      );
    } else {
      nodes.push(match[0]);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(stripDangerousMarkup(text.slice(last)));
  return (
    <p className="whitespace-pre-wrap">
      {nodes.map((node) => (typeof node === "string" ? stripDangerousMarkup(node) : node))}
    </p>
  );
}

export function MessageBody({
  text,
  images,
  onEditImagine,
  onSaveImage,
  onDownloadImage,
  onUseAsAgentInput,
  onFailure,
}: {
  text: string;
  images?: MsgImage[];
  onEditImagine?: (src: string) => void;
  onSaveImage?: (src: string, alt: string) => void;
  onDownloadImage?: (src: string, alt: string) => void;
  onUseAsAgentInput?: (src: string, alt: string) => void;
  /** Optional: reportFailure for top View log — mount wiring may live outside this lane. */
  onFailure?: (message: string, retry: () => void) => void;
}) {
  const blocks = splitBlocks(text);
  const [copied, setCopied] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<CopyCodeState>({ status: "idle" });

  function copyBlock(blockIndex: number, code: string) {
    const params = snapshotCopyCodeParams(blockIndex, code);
    const run = () => {
      void runCopyCode(params, resolveClipboardWriter(typeof globalThis !== "undefined" ? globalThis : null)).then((result) => {
        if (result.ok) {
          setCopied(result.blockIndex);
          setCopyState({ status: "ok", blockIndex: result.blockIndex });
          return;
        }
        setCopied(null);
        setCopyState({ status: "error", message: result.message, params: result.params });
        const retry = onceRetry(() => run());
        if (retry) onFailure?.(result.message, retry);
      });
    };
    run();
  }

  return (
    <div className="space-y-2">
      {images?.map((image, index) =>
        image.dataUrl && isSafeImageSrc(image.dataUrl) ? (
          <InlineImage
            key={`attach-${index}`}
            src={image.dataUrl}
            alt={sanitizeMediaLabel(image.name) || `Attachment ${index + 1}`}
            onEditImagine={onEditImagine}
            onSave={onSaveImage}
            onDownload={onDownloadImage}
            onUseAsAgentInput={onUseAsAgentInput}
          />
        ) : image.blobId ? (
          <p key={`attach-${index}`} className="text-xs text-muted">
            Image reference {image.name || image.blobId} is stored offline and is still loading.
          </p>
        ) : null,
      )}
      {blocks.map((block, index) =>
        block.kind === "code" ? (
          <pre key={index} className="overflow-x-auto rounded-panel bg-bg p-3 text-xs">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-muted">{block.lang || "code"}</p>
              <button
                type="button"
                className="min-h-11 text-accent"
                data-testid="copy-code"
                onClick={() => copyBlock(index, block.code)}
              >
                {copied === index ? "Copied" : "Copy code"}
              </button>
            </div>
            <code>{block.code}</code>
            {copyState.status === "error" && copyState.params.blockIndex === index ? (
              <CopyCodeFailureBanner
                state={copyState}
                onRetry={onceRetry(() => copyBlock(copyState.params.blockIndex, copyState.params.code)) ?? (() => undefined)}
              />
            ) : null}
          </pre>
        ) : HAS_MARKDOWN_IMAGE.test(block.text) ? (
          <TextWithImages
            key={index}
            text={block.text}
            onEditImagine={onEditImagine}
            onSaveImage={onSaveImage}
            onDownloadImage={onDownloadImage}
            onUseAsAgentInput={onUseAsAgentInput}
          />
        ) : (
          <MarkdownProse key={index} text={block.text} />
        ),
      )}
    </div>
  );
}
