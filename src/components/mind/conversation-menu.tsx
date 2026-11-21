import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CONVERSATION_ACTIONS, type ConversationAction } from "@/lib/mind/conversation-actions";
import { finishMenu, MenuMotion } from "@/components/mind/menu-material";

const GROUPS: { ids: ConversationAction[] }[] = [
  { ids: ["project"] },
  { ids: ["copy", "rename", "files", "scheduled"] },
  { ids: ["pin", "favorite", "archive", "quote"] },
  { ids: ["delete"] },
];

let anchorRect: DOMRect | null = null;

export function rememberMenuAnchor(node: HTMLElement) {
  anchorRect = node.getBoundingClientRect();
}

export function ActionsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function RowIcon({ id }: { id: ConversationAction }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (id === "project") return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 5.5h4l1.2 1.5H15v7.2H3z" {...common} /></svg>;
  if (id === "copy") return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M7.2 10.8a3.2 3.2 0 0 0 4.6.2l1.8-1.8a3.2 3.2 0 0 0-4.5-4.5L8 5.8" {...common} /><path d="M10.8 7.2a3.2 3.2 0 0 0-4.6-.2L4.4 8.8a3.2 3.2 0 0 0 4.5 4.5L10 12.2" {...common} /></svg>;
  if (id === "rename") return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M10.5 4.2 13.8 7.5 6.2 15.1H3v-3.2z" {...common} /></svg>;
  if (id === "files") return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M4 3.5h6.2L14 7.2V14.5H4z" {...common} /><path d="M10 3.6V7.4h3.6" {...common} /></svg>;
  if (id === "scheduled") return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="5.5" {...common} /><path d="M9 6.2V9l2 1.4" {...common} /></svg>;
  if (id === "pin") return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M6.2 3.8h5.6l-.6 3.2 2.2 1.4H4.6l2.2-1.4zM9 8.6V14" {...common} /></svg>;
  if (id === "favorite") return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="m9 3.6 1.5 3.2 3.5.4-2.6 2.3.7 3.4L9 11.2 6 13l.7-3.4L4 7.2l3.5-.4z" {...common} /></svg>;
  if (id === "archive") return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 5h11v8.2H3.5zM3.2 5l1-1.8h9.6l1 1.8M9 8.2v3.2" {...common} /></svg>;
  if (id === "quote") return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M4 12.5c0-3 1.2-5.2 3.4-6.4M10.2 12.5c0-3 1.2-5.2 3.4-6.4" {...common} /></svg>;
  return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M5 5.5h8M6.2 5.5l.4 9h4.8l.4-9M7.4 5.4 7.8 4h2.4l.4 1.4" {...common} /></svg>;
}

export function ActionsButton({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="grid size-11 shrink-0 place-items-center rounded-full text-muted"
      aria-label={`Actions for ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        rememberMenuAnchor(event.currentTarget);
        onOpen();
      }}
    >
      <ActionsIcon />
    </button>
  );
}

function placeCard(card: HTMLElement) {
  const margin = 12;
  const width = Math.min(340, window.innerWidth - margin * 2);
  card.style.setProperty("width", `${width}px`, "important");
  const height = card.getBoundingClientRect().height || 360;
  const anchor = anchorRect;
  let top = anchor ? anchor.bottom + 8 : Math.max(margin, window.innerHeight - height - 24);
  let left = anchor ? anchor.right - width : (window.innerWidth - width) / 2;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, (anchor?.top ?? window.innerHeight) - height - 8);
  if (left < margin) left = margin;
  if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
  card.style.setProperty("position", "fixed", "important");
  card.style.setProperty("top", `${top}px`, "important");
  card.style.setProperty("left", `${left}px`, "important");
  card.style.setProperty("right", "auto", "important");
  card.style.setProperty("bottom", "auto", "important");
  card.style.setProperty("margin", "0", "important");
}

export function ActionOverlay({
  label,
  title,
  onClose,
  children,
}: {
  label: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    finishMenu(node);
    if (reduce) node.style.removeProperty("animation");
    node.style.setProperty("z-index", "1201", "important");
    placeCard(node);
    node.querySelector<HTMLElement>("button, input, select")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, children]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0"
      role="presentation"
      data-testid="action-overlay"
      style={{ zIndex: 1200, background: "transparent" }}
      onMouseDown={onClose}
    >
      <MenuMotion />
      <div
        ref={panel}
        role="dialog"
        aria-modal="false"
        aria-label={label}
        className="adrian-menu adrian-layer"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="sr-only">{title}</p>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ConversationMenu({
  title,
  projects,
  pinned,
  favorite,
  archived,
  extras = [],
  onClose,
  onAction,
}: {
  title: string;
  projects: readonly { id: string; name: string }[];
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  extras?: readonly { label: string; onPick: () => void }[];
  onClose: () => void;
  onAction: (action: ConversationAction, extra?: { projectId?: string | null; title?: string }) => void;
}) {
  const [projectOpen, setProjectOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const labelFor = (id: ConversationAction, label: string) => {
    if (id === "pin") return pinned ? "Unpin" : "Pin";
    if (id === "favorite") return favorite ? "Unfavorite" : "Favorite";
    if (id === "archive") return archived ? "Restore" : "Archive";
    return label;
  };
  const byId = new Map(CONVERSATION_ACTIONS.map((item) => [item.id, item]));
  return (
    <ActionOverlay label={`Actions for ${title}`} title={title} onClose={onClose}>
      {projectOpen ? (
        <div className="grid" data-testid="project-picker">
          <button type="button" className="flex min-h-11 items-center rounded-2xl px-3 text-left text-sm" onClick={() => setProjectOpen(false)}>Back</button>
          <div className="mx-3 border-t border-line" />
          {projects.length === 0 ? <p className="px-3 py-3 text-sm text-muted">No projects yet. Nothing was moved.</p> : null}
          {projects.map((project) => (
            <button key={project.id} type="button" className="flex min-h-11 items-center rounded-2xl px-3 text-left text-sm" onClick={() => onAction("project", { projectId: project.id })}>
              {project.name}
            </button>
          ))}
          <button type="button" className="flex min-h-11 items-center rounded-2xl px-3 text-left text-sm" onClick={() => onAction("project", { projectId: null })}>Remove from project</button>
        </div>
      ) : renaming ? (
        <form className="grid gap-2 p-2" onSubmit={(event) => { event.preventDefault(); onAction("rename", { title: draft }); }}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Conversation name" className="min-h-11 rounded-2xl border border-line bg-transparent px-3 text-sm" />
          <button type="submit" className="min-h-11 rounded-2xl bg-accent text-sm font-semibold text-accent-ink">Save name</button>
        </form>
      ) : (
        <div>
          {GROUPS.map((group, index) => (
            <div key={group.ids.join("-")}>
              {index > 0 ? <div className="mx-3 my-1 border-t border-line" data-testid="menu-line" /> : null}
              {group.ids.map((id) => {
                const item = byId.get(id);
                if (!item) return null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm"
                    style={item.id === "delete" ? { color: "rgb(248 113 113)" } : undefined}
                    onClick={() => {
                      if (item.id === "project") { setProjectOpen(true); return; }
                      if (item.id === "rename") { setRenaming(true); return; }
                      onAction(item.id);
                    }}
                  >
                    <RowIcon id={item.id} />
                    <span className="min-w-0 flex-1">{labelFor(item.id, item.label)}</span>
                    {item.id === "project" ? <span aria-hidden="true">›</span> : null}
                  </button>
                );
              })}
              {group.ids.includes("quote") ? extras.map((extra) => (
                <button key={extra.label} type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" onClick={() => { extra.onPick(); onClose(); }}>
                  {extra.label}
                </button>
              )) : null}
            </div>
          ))}
        </div>
      )}
    </ActionOverlay>
  );
}
