import { useMemo, useRef, useState } from "react";
import {
  PERSONA_CATEGORIES,
  buildPersonaDirectory,
  emptyStateForCategory,
  filterPersonaDirectory,
  selectPersona,
  type PersonaCard,
  type PersonaCategoryId,
} from "@/lib/mind/personas";
import type { Workspace } from "@/lib/mind/types";
import { persistPersonaOpen } from "@/lib/mind/personas/selection";

function botAvatarSrc(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("document") || lower.includes("personal") || lower.includes("content") || lower.includes("knowledge")) {
    return "/avatars/avatar-documents.webp";
  }
  if (lower.includes("research") || lower.includes("data")) return "/avatars/avatar-research.webp";
  if (lower.includes("cod") || lower.includes("build") || lower.includes("browser") || lower.includes("project")) {
    return "/avatars/avatar-build.webp";
  }
  if (lower.includes("notion")) return "/avatars/avatar-notion.webp";
  if (lower.includes("email") || lower.includes("mail")) return "/avatars/avatar-email.webp";
  return "/avatars/avatar-documents.webp";
}

export function PersonaDirectoryView({
  ws,
  setWs,
  onOpened,
}: {
  ws: Workspace;
  setWs: (updater: (prev: Workspace) => Workspace) => void;
  /** Optional hook after a successful select (e.g. router navigate). */
  onOpened?: (href: string, card: PersonaCard) => void;
}) {
  const [category, setCategory] = useState<PersonaCategoryId | "all">("official");
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const latestWorkspace = useRef(ws);
  latestWorkspace.current = ws;

  const directory = useMemo(
    () => buildPersonaDirectory({ agents: ws.agents, deployments: ws.deployments }),
    [ws.agents, ws.deployments],
  );
  const visible = useMemo(
    () => filterPersonaDirectory(directory, { category, query }),
    [directory, category, query],
  );
  const empty = emptyStateForCategory(category, visible.length);

  function openCard(card: PersonaCard) {
    const result = selectPersona(latestWorkspace.current, card);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    let persisted: ReturnType<typeof persistPersonaOpen>;
    try {
      persisted = persistPersonaOpen(window.localStorage, result.ws, result.selection);
    } catch {
      setNote("Could not access local storage. Nothing was opened.");
      return;
    }
    if (!persisted.ok) {
      if (persisted.workspacePersisted) {
        latestWorkspace.current = result.ws;
        setWs(() => result.ws);
      }
      setNote(
        persisted.workspacePersisted
          ? "The persona was saved, but its selection could not be saved. Nothing was opened."
          : "Could not save this persona. Nothing was opened.",
      );
      return;
    }
    latestWorkspace.current = result.ws;
    setWs(() => result.ws);
    setNote(
      `Saved ${result.selection.agentName} locally. Opening Chat; the selected-agent handoff is not yet verified.`,
    );
    if (onOpened) {
      onOpened(result.href, card);
    } else if (typeof window !== "undefined") {
      window.location.assign(result.href);
    }
  }

  return (
    <section className="page-shell" data-testid="persona-directory">
      <div className="page-hero mb-4">
        <div className="mb-3 flex items-center gap-3">
          <img src="/brand/logo-mark.jpg" alt="" className="logo-mark size-10 rounded-2xl object-cover" />
          <div>
            <p className="meta-label">Explore</p>
            <h1 className="font-display text-3xl font-bold">Persona directory</h1>
          </div>
        </div>
        <p className="text-sm text-muted">
          Browse local agent templates and saved bots. Cards are never presented as live remote Poe or Character.AI
          personas. Selecting one saves a local agent and opens Chat; the selected-agent handoff is not yet verified.
        </p>
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search personas"
          aria-label="Search personas"
          className="min-h-11 w-full flex-1 rounded-panel border border-line bg-bg px-3 text-sm"
          data-testid="persona-search"
        />
        <a href="/" className="inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm">
          Back to Chat
        </a>
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Persona categories">
        <button
          type="button"
          role="tab"
          aria-selected={category === "all"}
          className={`min-h-11 rounded-panel border px-3 text-sm ${category === "all" ? "border-fg bg-surface-2" : "border-line"}`}
          onClick={() => setCategory("all")}
        >
          All
        </button>
        {PERSONA_CATEGORIES.map((item) => {
          const count = directory.counts[item.id];
          const on = category === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={`min-h-11 rounded-panel border px-3 text-sm ${on ? "border-fg bg-surface-2" : "border-line"}`}
              onClick={() => setCategory(item.id)}
              data-testid={`persona-cat-${item.id}`}
            >
              {item.label}
              <span className="ml-2 text-muted">{count}</span>
            </button>
          );
        })}
      </div>

      {category !== "all" ? (
        <p className="mb-3 text-sm text-muted">
          {PERSONA_CATEGORIES.find((item) => item.id === category)?.description}
        </p>
      ) : null}

      {empty ? (
        <div className="dense-card rounded-panel border border-line p-4 text-sm text-muted" data-testid="persona-empty">
          {empty}
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="persona-grid">
          {visible.map((card) => (
            <li key={card.id} className="glow-card rounded-panel border border-line/80 p-4">
              <div className="flex items-start gap-3">
                <img src={botAvatarSrc(card.name)} alt="" className="bot-avatar-img size-10" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{card.name}</p>
                    <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                      {card.badge}
                    </span>
                    <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                      Not live
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{card.description}</p>
                  <p className="mt-2 text-xs text-muted">
                    {card.statusLabel}. Tools: {card.tools.join(", ") || "none"}.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="mt-3 min-h-11 w-full rounded-panel border border-line bg-accent px-3 text-sm font-semibold text-accent-ink"
                onClick={() => openCard(card)}
                data-testid={`persona-open-${card.id}`}
              >
                Save and open Chat
              </button>
            </li>
          ))}
        </ul>
      )}

      {note ? (
        <p className="mt-4 text-sm text-muted" data-testid="persona-note">
          {note}
        </p>
      ) : null}
    </section>
  );
}
