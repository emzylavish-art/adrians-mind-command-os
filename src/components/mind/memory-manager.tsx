import { useMemo, useRef, useState } from "react";
import type { MemoryItem, MemoryScope, Workspace } from "@/lib/mind/types";
import { addMemory, deleteMemory, reviseMemory } from "@/lib/mind/workspace";
import { MEMORY_TEXT_MAX } from "@/lib/mind/memory/constants";
import {
  MemoryActionFailureBanner,
  onceRetry,
  runMemoryAction,
  snapshotMemoryActionParams,
  type MemoryActionParams,
  type MemoryActionState,
} from "@/lib/mind/memory-action";
import { MemorySavedIndicator } from "./memory-saved-indicator";

function stamp(value: string) {
  if (!value) return "unknown time";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function MemoryManagerView({
  ws,
  setWs,
  demoSignal,
  onFailure,
}: {
  ws: Workspace;
  setWs: (updater: (prev: Workspace) => Workspace) => void;
  /** Optional demo of the in-thread indicator (no command-app mount). */
  demoSignal?: { memorySaved: boolean; savedMemoryId?: string | null };
  /** Optional: reportFailure for top View log — mount wiring may live outside this lane. */
  onFailure?: (message: string, retry: () => void) => void;
}) {
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<MemoryScope>("global");
  const [draft, setDraft] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [actionState, setActionState] = useState<MemoryActionState>({ status: "idle" });
  const [lastSaved, setLastSaved] = useState<{ memorySaved: boolean; savedMemoryId: string | null }>({
    memorySaved: false,
    savedMemoryId: null,
  });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ws.memories
      .filter((item) => !item.archived)
      .filter((item) => (!q ? true : item.text.toLowerCase().includes(q) || item.scope.includes(q)))
      .slice()
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [ws.memories, query]);

  function applyAction(params: MemoryActionParams) {
    const snap = snapshotMemoryActionParams(params);
    const run = () => {
      let createdId: string | null = null;
      const result = runMemoryAction(snap, {
        saveNew: ({ text, scope: nextScope }) => {
          setWs((prev) => {
            const before = new Set(prev.memories.map((item) => item.id));
            const next = addMemory(prev, {
              scope: nextScope,
              text,
              source: "owner",
              projectId: null,
              chatId: null,
            });
            createdId = next.memories.find((item) => !before.has(item.id))?.id ?? null;
            return next;
          });
          setDraft("");
          setLastSaved({ memorySaved: true, savedMemoryId: createdId });
        },
        saveEdit: ({ id, text }) => {
          setWs((prev) => reviseMemory(prev, id, text));
          setEditId(null);
          setLastSaved({ memorySaved: true, savedMemoryId: id });
        },
        remove: ({ id }) => {
          setWs((prev) => deleteMemory(prev, id));
          setLastSaved((prev) =>
            prev.savedMemoryId === id ? { memorySaved: false, savedMemoryId: null } : prev,
          );
        },
      });
      if (result.ok) {
        setActionState({ status: "ok" });
        return;
      }
      setActionState({ status: "error", message: result.message, params: result.params });
      const retry = onceRetry(() => run());
      if (retry) onFailure?.(result.message, retry);
    };
    run();
  }

  function saveNew() {
    applyAction({ kind: "save_new", text: draft, scope });
  }

  function saveEdit(item: MemoryItem) {
    applyAction({ kind: "save_edit", id: item.id, text: editText });
  }

  function remove(item: MemoryItem) {
    applyAction({ kind: "delete", id: item.id });
  }

  const signal = demoSignal ?? lastSaved;

  return (
    <section className="page-shell" data-testid="memory-manager">
      <div className="page-hero mb-4">
        <div className="mb-3 flex items-center gap-3">
          <img src="/brand/logo-mark.jpg" alt="" className="logo-mark size-10 rounded-2xl object-cover" />
          <div>
            <p className="meta-label">Memory</p>
            <h1 className="font-display text-3xl font-bold">Memory manager</h1>
          </div>
        </div>
        <p className="text-sm text-muted">
          Real notes stored in this workspace (scopes: global, project, chat). Delete removes the row. Text is
          length-capped at {MEMORY_TEXT_MAX} and rendered as plain text (React escapes markup).
        </p>
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <a href="/" className="inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm">
          Back to Chat
        </a>
        <div className="flex min-h-11 flex-col justify-center rounded-panel border border-line bg-surface px-3 py-2 text-sm text-muted">
          <p data-testid="memory-permission-guidance">
            This page manages saved notes. Whether a chat may use them is a separate per-chat choice in Chat.
          </p>
          <p className="mt-1 text-xs" data-testid="memory-scope-guidance">
            This page can save global notes only. Project and chat notes need a selected owner; existing scoped notes remain listed below.
          </p>
        </div>
      </div>

      <div className="mb-4">
        <MemorySavedIndicator memorySaved={signal.memorySaved} savedMemoryId={signal.savedMemoryId} />
      </div>

      <div className="glow-card mb-4 grid gap-3 rounded-panel border border-line p-4">
        <label className="text-sm font-semibold text-fg" htmlFor="memory-draft">
          Add a note
        </label>
        <textarea
          id="memory-draft"
          data-testid="memory-draft"
          value={draft}
          maxLength={MEMORY_TEXT_MAX}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          placeholder="Write a note you want kept"
          className="rounded-panel border border-line bg-bg px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Memory scope"
            data-testid="memory-scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as MemoryScope)}
            className="min-h-11 rounded-panel border border-line bg-bg px-3 text-sm"
          >
            <option value="global">global</option>
            <option value="project" disabled>project (select a project first)</option>
            <option value="chat" disabled>chat (select a chat first)</option>
          </select>
          <button
            type="button"
            data-testid="memory-add"
            className="min-h-11 rounded-panel border border-fg bg-surface px-4 text-sm font-semibold"
            onClick={saveNew}
          >
            Save note
          </button>
        </div>
        <MemoryActionFailureBanner
          state={actionState}
          onRetry={
            actionState.status === "error"
              ? onceRetry(() => applyAction(actionState.params)) ?? (() => undefined)
              : () => undefined
          }
        />
      </div>

      <div className="mb-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search notes"
          aria-label="Search notes"
          ref={searchInput}
          data-testid="memory-search"
          className="min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm"
        />
      </div>

      {visible.length === 0 ? (
        <div
          className="dense-card rounded-panel border border-line p-6 text-center text-sm text-muted"
          data-testid="memory-empty"
        >
          {query.trim() && ws.memories.some((item) => !item.archived) ? (
            <>
              <p role="status">No notes match your search.</p>
              <button type="button" className="mt-2 min-h-11 rounded-panel border border-line px-3" onClick={() => { setQuery(""); searchInput.current?.focus(); }}>Clear search</button>
            </>
          ) : (
            <p>No saved notes yet. Add a note above to keep it in this workspace.</p>
          )}
        </div>
      ) : (
        <ul className="space-y-2" data-testid="memory-list">
          {visible.map((item) => (
            <li key={item.id} className="rounded-panel border border-line bg-surface p-3 text-sm" data-testid="memory-row">
              {editId === item.id ? (
                <textarea
                  value={editText}
                  maxLength={MEMORY_TEXT_MAX}
                  onChange={(event) => setEditText(event.target.value)}
                  className="min-h-20 w-full rounded-panel border border-line bg-bg px-2 py-1"
                  data-testid="memory-edit-text"
                />
              ) : (
                <p className="whitespace-pre-wrap text-fg" data-testid="memory-text">
                  {item.text}
                </p>
              )}
              <p className="mt-1 text-xs text-muted" data-testid="memory-scope-label">
                scope: {item.scope}
                {item.projectId ? ` · project ${item.projectId}` : ""}
                {item.chatId ? ` · chat ${item.chatId}` : ""} · {stamp(item.updatedAt || item.createdAt)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {editId === item.id ? (
                  <button
                    type="button"
                    className="min-h-11 rounded-panel border border-line px-3"
                    data-testid="memory-save-edit"
                    onClick={() => saveEdit(item)}
                  >
                    Save edit
                  </button>
                ) : (
                  <button
                    type="button"
                    className="min-h-11 rounded-panel border border-line px-3"
                    data-testid="memory-edit"
                    onClick={() => {
                      setEditId(item.id);
                      setEditText(item.text);
                    }}
                  >
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  className="min-h-11 rounded-panel border border-line px-3"
                  data-testid="memory-delete"
                  onClick={() => remove(item)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
