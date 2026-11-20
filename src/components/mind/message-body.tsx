import { useId, useState, type ReactNode } from "react";
import { splitBlocks } from "@/lib/mind/blocks";
import { InlineImage } from "@/components/mind/media/inline-image";
import { MarkdownProse } from "@/components/mind/markdown-prose";
import type { MsgImage } from "@/lib/mind/types";
import {
  CopyCodeFailureBanner,
  onceRetry,
  resolveClipboardWriter,
  runCopyCode,
  snapshotCopyCodeParams,
  type CopyCodeState,
} from "@/lib/mind/copy-code-action";

const MD_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HAS_MARKDOWN_IMAGE = /!\[[^\]]*\]\([^)\s]+/;

function TextWithImages({
  text,
  onEditImagine,
  onSaveImage,
  onDownloadImage,
}: {
  text: string;
  onEditImagine?: (src: string) => void;
  onSaveImage?: (src: string, alt: string) => void;
  onDownloadImage?: (src: string, alt: string) => void;
}) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(MD_IMAGE.source, "g");
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(<MarkdownProse key={`text-${last}`} text={text.slice(last, match.index)} />);
    const alt = match[1] || "image";
    const src = match[2]!;
    if (src.startsWith("data:image/") || /^https?:\/\//i.test(src)) {
      nodes.push(
        <InlineImage
          key={`img-${match.index}`}
          src={src}
          alt={alt}
          onEditImagine={src.startsWith("data:image/") ? onEditImagine : undefined}
          onSave={onSaveImage}
          onDownload={onDownloadImage}
        />,
      );
    } else {
      nodes.push(match[0]);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(<MarkdownProse key={`text-${last}`} text={text.slice(last)} />);
  return <div className="space-y-2">{nodes}</div>;
}

export function MessageBody({
  text,
  images,
  onEditImagine,
  onSaveImage,
  onDownloadImage,
  onFailure,
}: {
  text: string;
  images?: MsgImage[];
  onEditImagine?: (src: string) => void;
  onSaveImage?: (src: string, alt: string) => void;
  onDownloadImage?: (src: string, alt: string) => void;
  /** Optional: reportFailure for top View log — mount wiring may live outside this lane. */
  onFailure?: (message: string, retry: () => void) => void;
}) {
  return <AnswerBody text={text} images={images} onEditImagine={onEditImagine} onSaveImage={onSaveImage} onDownloadImage={onDownloadImage} onFailure={onFailure} />;
}

export function AnswerTabs({
  text,
  images,
  onEditImagine,
  onSaveImage,
  onDownloadImage,
  onFailure,
}: {
  text: string;
  images?: MsgImage[];
  onEditImagine?: (src: string) => void;
  onSaveImage?: (src: string, alt: string) => void;
  onDownloadImage?: (src: string, alt: string) => void;
  onFailure?: (message: string, retry: () => void) => void;
}) {
  const tabs = ["answer", "links", "images"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>("answer");
  const id = useId();
  const destinations = new Map<string, string>();
  for (const block of splitBlocks(text)) {
    if (block.kind !== "text") continue;
    const body = block.text.replace(MD_IMAGE, "").replace(/`[^`]*`/g, "");
    const prose = body.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, url: string) => {
      destinations.set(url, label);
      return "";
    });
    for (const [raw] of prose.matchAll(/https?:\/\/[^\s)>\]]+/g)) {
      const url = raw.replace(/[.,;]+$/, "");
      if (!destinations.has(url)) destinations.set(url, url);
    }
  }
  const links = [...destinations.entries()];
  const pictures = images ?? [];
  return (
    <div data-testid="answer-tabs">
      <div className="mb-2 flex flex-wrap gap-2" role="tablist" aria-label="Answer, links, and images" onKeyDown={(event) => {
        const index = tabs.indexOf(tab);
        const next = event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
          : event.key === "ArrowRight" ? (index + 1) % tabs.length
          : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        setTab(tabs[next]);
        event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
      }}>
        {tabs.map((item) => (
          <button key={item} id={`${id}-${item}`} type="button" role="tab" aria-selected={tab === item} aria-controls={`${id}-panel`} tabIndex={tab === item ? 0 : -1} className={`min-h-11 rounded-panel border px-3 text-xs ${tab === item ? "border-accent" : "border-line text-muted"}`} onClick={() => setTab(item)}>
            {item === "answer" ? "Answer" : item === "links" ? `Links${links.length ? ` ${links.length}` : ""}` : `Images${pictures.length ? ` ${pictures.length}` : ""}`}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0}>
      {tab === "links" ? (
        links.length ? <ul className="space-y-1">{links.map(([href, label]) => <li key={href}><a className="break-all text-accent underline" href={href} target="_blank" rel="noreferrer">{label}</a></li>)}</ul> : <p className="text-sm text-muted">No links were returned with this answer.</p>
      ) : tab === "images" ? (
        pictures.length ? pictures.map((image, index) => image.dataUrl ? <InlineImage key={index} src={image.dataUrl} alt={image.name || `Image ${index + 1}`} onEditImagine={onEditImagine} onSave={onSaveImage} onDownload={onDownloadImage} /> : <p key={index} className="break-words text-sm text-muted">{image.name || `Image ${index + 1}`} is unavailable on this device.</p>) : <p className="text-sm text-muted">No images were returned with this answer.</p>
      ) : (
        <AnswerBody text={text} images={images} onEditImagine={onEditImagine} onSaveImage={onSaveImage} onDownloadImage={onDownloadImage} onFailure={onFailure} />
      )}
      </div>
    </div>
  );
}

function AnswerBody({
  text,
  images,
  onEditImagine,
  onSaveImage,
  onDownloadImage,
  onFailure,
}: {
  text: string;
  images?: MsgImage[];
  onEditImagine?: (src: string) => void;
  onSaveImage?: (src: string, alt: string) => void;
  onDownloadImage?: (src: string, alt: string) => void;
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
        image.dataUrl ? (
          <InlineImage
            key={`attach-${index}`}
            src={image.dataUrl}
            alt={image.name || `Attachment ${index + 1}`}
            onEditImagine={onEditImagine}
            onSave={onSaveImage}
            onDownload={onDownloadImage}
          />
        ) : image.blobId ? (
          <p key={`attach-${index}`} className="text-xs text-muted">
            Image reference {image.name || image.blobId} is stored offline and is still loading.
          </p>
        ) : null,
      )}
      {blocks.map((block, index) =>
        block.kind === "code" ? (
          <div key={index} className="min-w-0 rounded-panel bg-bg p-3 text-xs">
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
            <pre tabIndex={0} aria-label={`${block.lang || "Code"} snippet`} className="overflow-x-auto"><code>{block.code}</code></pre>
            {copyState.status === "error" && copyState.params.blockIndex === index ? (
              <CopyCodeFailureBanner
                state={copyState}
                onRetry={onceRetry(() => copyBlock(copyState.params.blockIndex, copyState.params.code)) ?? (() => undefined)}
              />
            ) : null}
          </div>
        ) : HAS_MARKDOWN_IMAGE.test(block.text) ? (
          <TextWithImages
            key={index}
            text={block.text}
            onEditImagine={onEditImagine}
            onSaveImage={onSaveImage}
            onDownloadImage={onDownloadImage}
          />
        ) : (
          <MarkdownProse key={index} text={block.text} />
        ),
      )}
    </div>
  );
}
