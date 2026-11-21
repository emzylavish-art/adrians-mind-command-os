import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CONVERSATION_ACTIONS, type ConversationAction } from "@/lib/mind/conversation-actions";

const ACTION_GROUPS: { label: string; ids: ConversationAction[] }[] = [
  { label: "Organize", ids: ["project", "rename", "pin", "favorite", "archive", "scheduled"] },
  { label: "Share", ids: ["copy", "files", "quote"] },
  { label: "Remove", ids: ["delete"] },
];

export function ActionsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ActionsButton({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="grid size-11 shrink-0 place-items-center rounded-full text-muted"
      aria-label={`Actions for ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      <ActionsIcon />
    </button>
  );
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
    panel.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    const node = panel.current;
    if (!node) return;
    const light = document.documentElement.dataset.theme === "light";
    node.style.setProperty("background", light ? "#f7f7f8" : "#14161c", "important");
    node.style.setProperty("color", light ? "#18181b" : "#fafafa", "important");
    node.style.setProperty("opacity", "1", "important");
    node.style.setProperty("backdrop-filter", "none", "important");
    node.style.setProperty("box-shadow", "0 24px 80px rgba(0, 0, 0, 0.45)", "important");
    node.style.setProperty("max-height", "86vh", "important");
    node.style.setProperty("overflow-y", "auto", "important");
    node.querySelectorAll("button").forEach((button) => {
      button.style.setProperty("min-height", "2.75rem", "important");
      button.style.setProperty("height", "auto", "important");
      button.style.setProperty("margin", "0", "important");
    });
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 grid place-items-center p-4"
      role="presentation"
      style={{ zIndex: 80, background: "rgba(0, 0, 0, 0.55)" }}
      onMouseDown={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="adrian-layer w-full max-w-md rounded-panel border border-line bg-surface p-2"
        style={{ maxHeight: "70vh", overflowY: "auto", overflowX: "hidden" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="truncate px-3 py-2 text-sm font-semibold">{title}</p>
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
        <div className="grid gap-1">
          <button type="button" className="min-h-11 rounded-2xl px-3 text-left text-sm" onClick={() => setProjectOpen(false)}>Back</button>
          {projects.length === 0 ? <p className="px-3 py-2 text-sm text-muted">No projects yet. Nothing was moved.</p> : null}
          {projects.map((project) => (
            <button key={project.id} type="button" className="adrian-row min-h-11 rounded-2xl border border-line px-3 text-left text-sm" onClick={() => onAction("project", { projectId: project.id })}>
              {project.name}
            </button>
          ))}
          <button type="button" className="min-h-11 rounded-2xl px-3 text-left text-sm" onClick={() => onAction("project", { projectId: null })}>Remove from project</button>
        </div>
      ) : renaming ? (
        <form className="grid gap-2 p-2" onSubmit={(event) => { event.preventDefault(); onAction("rename", { title: draft }); }}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Conversation name" className="min-h-11 rounded-2xl border border-line bg-bg px-3 text-sm" />
          <button type="submit" className="min-h-11 rounded-2xl bg-accent text-sm font-semibold text-accent-ink">Save name</button>
        </form>
      ) : (
        <div className="grid gap-3">
          {ACTION_GROUPS.map((group) => (
            <section key={group.label} aria-label={group.label} style={{ display: "block" }}>
              <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted">{group.label}</p>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {group.ids.map((id) => {
                  const item = byId.get(id);
                  if (!item) return null;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="flex min-h-11 items-center justify-between rounded-2xl px-3 text-left text-sm"
                      style={item.id === "delete" ? { color: "rgb(248 113 113)" } : undefined}
                      onClick={() => {
                        if (item.id === "project") { setProjectOpen(true); return; }
                        if (item.id === "rename") { setRenaming(true); return; }
                        onAction(item.id);
                      }}
                    >
                      <span>{labelFor(item.id, item.label)}</span>
                      {item.id === "project" ? <span aria-hidden="true">›</span> : null}
                    </button>
                  );
                })}
                {group.label === "Share" ? extras.map((extra) => (
                  <button key={extra.label} type="button" className="flex min-h-11 items-center rounded-2xl px-3 text-left text-sm" onClick={() => { extra.onPick(); onClose(); }}>
                    {extra.label}
                  </button>
                )) : null}
              </div>
            </section>
          ))}
        </div>
      )}
    </ActionOverlay>
  );
}
