import { useId, useState } from "react";
import { ArrowDown, ArrowUp, ListEnd, ListOrdered, X } from "lucide-react";
import { CUE_LIMIT, CUE_TEXT_LIMIT, hasCueAttachments, type CuedMessage } from "@/lib/mind/message-cue";
import { ModalOverlay } from "./modal-overlay";
import "./composer-queue.css";

export function ComposerQueue({ title, items, description, canQueue, canRestore, onQueue, onRemove, onMove, onEdit, onRestore, onPause }: {
  title: string;
  items: CuedMessage[];
  description: string;
  canQueue: boolean;
  canRestore: boolean;
  onQueue?: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
  onEdit: (id: string, text: string) => void;
  onRestore: (id: string) => void;
  onPause?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const titleId = useId();
  const label = `${items.filter(item => !item.claimed).length} waiting${items.some(item => item.claimed) ? ", dispatch to check" : ""}`;
  function close() {
    setEdit(null);
    setOpen(false);
  }
  return <div className="composer-queue">
    {onQueue && <button type="button" className="queue-add" aria-label="Queue" disabled={!canQueue || items.length >= CUE_LIMIT} onClick={onQueue}>
      <ListEnd size={18} aria-hidden="true" /> Queue
    </button>}
    <button type="button" className="queue-view" aria-haspopup="dialog"
      aria-label={`Open ${title.toLowerCase()}, ${label}`} onClick={() => setOpen(true)}>
      <ListOrdered size={17} aria-hidden="true" />
      <span className="queue-count" aria-hidden="true">{items.length}</span>
    </button>
    <span className="sr-only" role="status">{items.length ? `${label} in ${title.toLowerCase()}` : ""}</span>
    {open && <ModalOverlay labelledBy={titleId} onDismiss={close} panelClassName="composer-queue-dialog">
      <div className="queue-sheet">
        <header className="queue-sheet-heading">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="queue-icon" aria-label="Close queue" onClick={close}><X size={18} aria-hidden="true" /></button>
        </header>
        <p className="queue-description">{description} {items.length} of {CUE_LIMIT} slots used.</p>
        {onPause && items.some(item => item.paused === false) && <button type="button" className="queue-action" onClick={onPause}>Hold waiting messages</button>}
        {items.length === 0 ? <p className="queue-empty">The queue is empty.</p> : <ol className="queue-list">
          {items.map((item, index) => <li key={item.id} className="queue-row" data-testid="cued-message">
            <div className="queue-row-header"><span>{index + 1}</span><span>{item.claimed ? "Dispatch started" : item.paused === false ? "Waiting" : "Held for review"}</span></div>
            {hasCueAttachments(item.attachments) && <p className="queue-message">
              Attachments: {[item.attachments?.file?.name, ...(item.attachments?.images.map(image => image.name || "Image") ?? [])].filter(Boolean).join(", ")}
            </p>}
            {item.attachmentsUnavailable && <p className="queue-description">Saved attachments are unavailable. Restore any text to reattach them.</p>}
            {edit?.id === item.id && !item.claimed ? <>
              <textarea autoFocus aria-label={`Edit queued message ${index + 1}`} value={edit.text} maxLength={CUE_TEXT_LIMIT}
                onChange={event => setEdit({ id: item.id, text: event.target.value })} />
              <div className="queue-actions">
                <button type="button" className="queue-action" disabled={!edit.text.trim() && !hasCueAttachments(item.attachments)} onClick={() => { onEdit(item.id, edit.text); setEdit(null); }}>Save edit</button>
                <button type="button" className="queue-action" onClick={() => setEdit(null)}>Cancel edit</button>
              </div>
            </> : <>
              {item.text && <p className="queue-message">{item.text}</p>}
              <div className="queue-actions">
                {item.claimed ? <p className="queue-description">Check the conversation for this message before sending it again.</p> : <>
                  <button type="button" className="queue-action" onClick={() => { onPause?.(); setEdit({ id: item.id, text: item.text }); }}>Edit</button>
                  <button type="button" className="queue-action" disabled={!canRestore || (!item.text.trim() && !hasCueAttachments(item.attachments))} onClick={() => { onRestore(item.id); close(); }}>To draft</button>
                  <button type="button" className="queue-icon" aria-label={`Move queued message ${index + 1} up`} disabled={index === 0} onClick={() => onMove(item.id, -1)}><ArrowUp size={16} aria-hidden="true" /></button>
                  <button type="button" className="queue-icon" aria-label={`Move queued message ${index + 1} down`} disabled={index === items.length - 1} onClick={() => onMove(item.id, 1)}><ArrowDown size={16} aria-hidden="true" /></button>
                </>}
                <button type="button" className="queue-action" aria-label={`Remove queued message ${index + 1}`} onClick={() => onRemove(item.id)}>{item.claimed ? "Dismiss notice" : "Remove"}</button>
              </div>
            </>}
          </li>)}
        </ol>}
      </div>
    </ModalOverlay>}
  </div>;
}
