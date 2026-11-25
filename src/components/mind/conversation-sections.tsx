import { useRef, useState } from "react";
import { groupConversationSections } from "@/lib/mind/conversation-sections";
import type { ConversationAction } from "@/lib/mind/conversation-actions";
import { ActionsButton, ConversationMenu } from "@/components/mind/conversation-menu";

type Row = { id: string; title: string; messages?: { at?: string }[]; favorite?: boolean; archived?: boolean };
type Extra = { label: string; onPick: () => void };

export function ConversationSections<T extends Row>({
  chats,
  activeId,
  onOpen,
  onAction,
  titleFor,
  projects = [],
  pinnedIds = [],
  scheduledChatIds = [],
  extras,
}: {
  chats: readonly T[];
  activeId?: string | null;
  onOpen: (id: string) => void;
  onAction: (action: ConversationAction, ids: string[], extra?: { projectId?: string | null; title?: string }) => void;
  titleFor?: (chat: T) => string;
  projects?: readonly { id: string; name: string }[];
  pinnedIds?: readonly string[];
  scheduledChatIds?: readonly string[];
  extras?: (ids: string[]) => readonly Extra[];
}) {
  const [menu, setMenu] = useState<{ title: string; ids: string[] } | null>(null);
  const active = chats.filter((chat) => chat.archived !== true);
  const archived = chats.filter((chat) => chat.archived === true);
  const groups = groupConversationSections(active);
  if (groups.length === 0 && archived.length === 0) return null;
  const openMenu = (title: string, ids: string[]) => setMenu({ title, ids });
  const chosen = menu ? chats.filter((chat) => menu.ids.includes(chat.id)) : [];
  return (
    <div className="w-full space-y-3" data-testid="conversation-sections">
      {groups.map((group) => (
        <section key={group.label} className="adrian-layer rounded-panel border border-line p-2" aria-label={`${group.label} conversations`}>
          <div className="flex items-center justify-between gap-2 px-1">
            <h3 className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-muted">{group.label}</h3>
            <ActionsButton label={`${group.label} section`} onOpen={() => openMenu(group.label, group.items.map((item) => item.id))} />
          </div>
          <ul className="grid gap-2">
            {group.items.map((chat) => (
              <ConversationRow
                key={chat.id}
                chat={chat}
                title={titleFor ? titleFor(chat) : chat.title}
                active={activeId === chat.id}
                scheduled={scheduledChatIds.includes(chat.id)}
                onOpen={() => onOpen(chat.id)}
                onHold={() => openMenu(titleFor ? titleFor(chat) : chat.title, [chat.id])}
              />
            ))}
          </ul>
        </section>
      ))}
      {archived.length > 0 && (
        <details className="adrian-layer rounded-panel border border-line p-2">
          <summary className="min-h-11 cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">Archived</summary>
          <ul className="mt-2 grid gap-2">
            {archived.map((chat) => (
              <ConversationRow
                key={chat.id}
                chat={chat}
                title={titleFor ? titleFor(chat) : chat.title}
                active={activeId === chat.id}
                scheduled={scheduledChatIds.includes(chat.id)}
                onOpen={() => onOpen(chat.id)}
                onHold={() => openMenu(titleFor ? titleFor(chat) : chat.title, [chat.id])}
              />
            ))}
          </ul>
        </details>
      )}
      {menu && (
        <ConversationMenu
          title={menu.title}
          projects={projects}
          pinned={chosen.length > 0 && chosen.every((chat) => pinnedIds.includes(chat.id))}
          favorite={chosen.length > 0 && chosen.every((chat) => chat.favorite === true)}
          archived={chosen.length > 0 && chosen.every((chat) => chat.archived === true)}
          extras={extras?.(menu.ids) ?? []}
          onClose={() => setMenu(null)}
          onAction={(action, extra) => {
            onAction(action, menu.ids, extra);
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}

function ConversationRow<T extends Row>({
  chat,
  title,
  active,
  scheduled,
  onOpen,
  onHold,
}: {
  chat: T;
  title: string;
  active: boolean;
  scheduled: boolean;
  onOpen: () => void;
  onHold: () => void;
}) {
  const hold = useRef<number | null>(null);
  const held = useRef(false);
  const clear = () => {
    if (hold.current != null) window.clearTimeout(hold.current);
    hold.current = null;
  };
  return (
    <li className="min-w-0">
      <button
        type="button"
        className={`adrian-row min-h-11 w-full rounded-2xl border border-line px-3 text-left text-sm ${active ? "bg-accent text-accent-ink" : ""}`}
        aria-current={active ? "true" : undefined}
        onPointerDown={() => {
          held.current = false;
          clear();
          hold.current = window.setTimeout(() => {
            held.current = true;
            onHold();
          }, 550);
        }}
        onPointerUp={clear}
        onPointerLeave={clear}
        onPointerCancel={clear}
        onClick={() => {
          if (held.current) {
            held.current = false;
            return;
          }
          onOpen();
        }}
      >
        <span className="block truncate">{title}{chat.favorite ? " · Favorite" : ""}{scheduled ? " · Schedule saved" : ""}</span>
      </button>
    </li>
  );
}
