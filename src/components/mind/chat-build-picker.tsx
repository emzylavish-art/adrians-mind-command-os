import { useState } from "react";
import type { Chat, LocalFile } from "@/lib/mind/types";
import { buildMessageEligible, chatBuildFiles, chatBuildImages, workImageKey, type BuildSelection } from "@/lib/mind/kimi/build-handoff";
import { ActionOverlay, rememberMenuAnchor } from "./conversation-menu";

export function ChatBuildPicker({ chat, files, initialMessageId, onStage }: {
  chat: Chat;
  files: LocalFile[];
  initialMessageId: string;
  onStage: (selection: BuildSelection) => string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState("");
  const eligibleMessages = open ? chat.messages.filter(buildMessageEligible) : [];
  const eligibleFiles = open ? chatBuildFiles(chat, files) : [];
  const eligibleImages = open ? chatBuildImages(chat) : [];
  const toggle = (current: string[], id: string) => current.includes(id) ? current.filter(value => value !== id) : [...current, id];
  return <>
    <button type="button" className="min-h-11 px-3 text-left text-xs" onClick={event => {
      rememberMenuAnchor(event.currentTarget);
      setMessages(chat.messages.some(message => message.id === initialMessageId && buildMessageEligible(message)) ? [initialMessageId] : []);
      setAttachments([]);
      setImages([]);
      setError("");
      setOpen(true);
    }}>Continue in Work</button>
    {open && <ActionOverlay label="Continue in Work" title="Continue in Work" onClose={() => setOpen(false)}>
      <div className="space-y-3 p-3">
        <h3 className="font-semibold">Choose what to carry over</h3>
        <p className="text-sm text-muted">Build will open for review with the copies you select.</p>
        <div className="max-h-[min(44svh,20rem)] space-y-3 overflow-auto">
          {!!eligibleMessages.length && <fieldset>
            <legend className="text-sm font-semibold">Messages</legend>
            {eligibleMessages.map(message => <label key={message.id} className="flex min-h-11 items-start gap-2 rounded-panel px-2 py-1.5 hover:bg-surface">
              <input className="mt-1" type="checkbox" checked={messages.includes(message.id)} onChange={() => setMessages(current => toggle(current, message.id))} />
              <span className="min-w-0"><strong className="block text-xs">{message.role === "user" ? "You" : "Adrian"}</strong><span className="line-clamp-2 break-words text-sm">{message.content.slice(0, 220)}</span></span>
            </label>)}
          </fieldset>}
          {!!eligibleFiles.length && <fieldset>
            <legend className="text-sm font-semibold">Conversation and project files</legend>
            {eligibleFiles.map(file => <label key={file.id} className="flex min-h-11 items-center gap-2 rounded-panel px-2 py-1.5 hover:bg-surface">
              <input type="checkbox" checked={attachments.includes(file.id)} onChange={() => setAttachments(current => toggle(current, file.id))} />
              <span className="min-w-0 break-all text-sm">{file.name}{file.partial ? " · retained excerpt" : ""}{file.original ? " · original available on this device when retained" : ""}</span>
            </label>)}
          </fieldset>}
          {!!eligibleImages.length && <fieldset>
            <legend className="text-sm font-semibold">Images for planning</legend>
            {eligibleImages.map(image => <label key={workImageKey(image)} className="flex min-h-11 items-center gap-2 rounded-panel px-2 py-1.5 hover:bg-surface">
              <input type="checkbox" checked={images.includes(workImageKey(image))} onChange={() => setImages(current => toggle(current, workImageKey(image)))} />
              <span className="min-w-0 break-all text-sm">{image.name}</span>
            </label>)}
          </fieldset>}
        </div>
        {error && <p className="text-sm" role="alert">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="min-h-11 px-3" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="min-h-11 rounded-panel bg-accent px-3 text-accent-ink" disabled={!messages.length && !attachments.length && !images.length} onClick={event => {
            event.stopPropagation();
            const issue = onStage({ chatId: chat.id, messages, files: attachments, images });
            if (issue) setError(issue);
            else setOpen(false);
          }}>Review in Work</button>
        </div>
      </div>
    </ActionOverlay>}
  </>;
}
