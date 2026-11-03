import { useMemo, useState } from "react";
import {
  PERSONA_CATEGORIES,
  buildPersonaDirectory,
  emptyStateForCategory,
  filterPersonaDirectory,
  writePersonaSelection,
  type PersonaCard,
  type PersonaCategoryId,
} from "@/lib/mind/personas";
import {
  PersonaSelectFailureBanner,
  onceRetry,
  runPersonaSelect,
  snapshotPersonaSelectParams,
  type PersonaSelectActionState,
} from "@/lib/mind/persona-select-action";
import type { Workspace } from "@/lib/mind/types";

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
  onFailure,
}: {
  ws: Workspace;
  setWs: (updater: (prev: Workspace) => Workspace) => void;
  /** Optional hook after a successful select (e.g. router navigate). */
  onOpened?: (href: string, card: PersonaCard) => void;
  /** Optional: reportFailure for top View log — mount wiring may live outside this lane. */
  onFailure?: (message: string, retry: () => void) => void;
}) {
  const [category, setCategory] = useState<PersonaCategoryId | "all">("official");
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [selectState, setSelectState] = useState<PersonaSelectActionState>({ status: "idle" });

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
    const params = snapshotPersonaSelectParams(card);
    const run = () => {
      const result = runPersonaSelect(ws, params);
      if (!result.ok) {
        setSelectState({
          status: "error",
          kind: result.kind,
          message: result.message,
          params: result.params,
        });
        setNote(null);
        const retry = onceRetry(() => run());
        if (retry) onFailure?.(result.message, retry);
        return;
      }
      setSelectState({ status: "idle" });
      setWs(() => result.result.ws);
      try {
        writePersonaSelection(localStorage, result.result.selection);
      } catch {
        /* storage may be unavailable in locked-down contexts */
      }
      setNote(
        `Opened ${result.result.selection.agentName} through agent mode. Chat uses the existing orchestrator path. CommandApp URL/localStorage mount is pending if the main shell does not read the selection yet.`,
      );
      onOpened?.(result.result.href, card);
      if (typeof window !== "undefined") {
        window.location.assign(result.result.href);
      }
    };
    run();
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
          personas. Selecting one routes into Chat in agent mode through the existing orchestrator path.
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
                Open in Chat (agent mode)
              </button>
            </li>
          ))}
        </ul>
      )}

      <PersonaSelectFailureBanner
        state={selectState}
        onRetry={
          selectState.status === "error"
            ? onceRetry(() => openCard({
                id: selectState.params.cardId,
                name: selectState.params.name,
                description: selectState.params.description,
                role: selectState.params.role,
                category: selectState.params.category,
                roleCategory: selectState.params.roleCategory,
                source: selectState.params.source,
                templateName: selectState.params.templateName,
                agentId: selectState.params.agentId,
                tools: selectState.params.tools,
                live: false,
                badge: selectState.params.badge,
                statusLabel: selectState.params.statusLabel,
              })) ?? (() => undefined)
            : () => undefined
        }
      />

      {note && selectState.status !== "error" ? (
        <p className="mt-4 text-sm text-muted" data-testid="persona-note">
          {note}
        </p>
      ) : null}
    </section>
  );
}
