import { useEffect, useRef } from "react";
import { PORTRAIT_FALLBACK_URL, markPortraitMissing } from "@/lib/mind/dashboard/portrait-resolve";
import { sanitizeNotionPlainText } from "@/lib/mind/dashboard/notion-plain";
import type { BotNode } from "@/lib/mind/dashboard/types";
import type { NotionSnapPage } from "@/lib/mind/dashboard/notion-graph-core";
import {
  NO_SOURCE,
  buildBotDetailView,
  formatWat,
  notionNeighborIds,
  type BotDetailView,
} from "@/lib/mind/dashboard/bot-detail";
import type { DashboardStatus } from "@/lib/mind/dashboard/types";

export type SpendView =
  | { available: false; reason: string }
  | { available: true; summary: string };

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const v = value && value.trim() ? value : NO_SOURCE;
  return (
    <>
      {label}: <span className={v === NO_SOURCE ? "dash3d-muted" : undefined}>{v}</span>
      <br />
    </>
  );
}

function BotDetailBody({ detail, spend, portraitSrc }: { detail: BotDetailView; spend?: SpendView | null; portraitSrc?: string | null }) {
  return (
    <>
      <h2 id="dash3d-node-detail-title">Star detail</h2>
      {portraitSrc ? (
        <img
          className="dash3d-portrait"
          src={portraitSrc}
          decoding="async"
          loading="lazy"
          alt=""
          width={72}
          height={72}
          onError={(e) => {
            const img = e.currentTarget;
            const botId = String(img.dataset.botId || detail.botId || "");
            if (botId) markPortraitMissing(botId);
            if (img.src !== PORTRAIT_FALLBACK_URL && !img.src.endsWith("portrait-dashboard.webp")) {
              img.src = PORTRAIT_FALLBACK_URL;
            }
          }}
          data-bot-id={detail.botId}
        />
      ) : null}
      <p className="dash3d-title dash3d-node-title" title={detail.name}>{detail.name}</p>
      <p>
        <span className={`dash3d-dot ${detail.health}`} /> <strong>{detail.health}</strong>
        <span className="dash3d-muted"> — {detail.reason || NO_SOURCE}</span>
      </p>
      <p className="dash3d-mono dash3d-muted" style={{ marginTop: "0.75rem" }}>
        <Field label="lane health" value={detail.laneHealthLine} />
        <Field label="lock" value={detail.lockFile} />
        <Field label="status" value={detail.lockStatus} />
        <Field label="claimed_at" value={detail.claimedAt ? formatWat(detail.claimedAt) : null} />
        <Field label="heartbeat" value={detail.heartbeatAt ? formatWat(detail.heartbeatAt) : null} />
        <Field label="task" value={detail.task} />
        <Field label="branch" value={detail.branch} />
        <Field label="worktree" value={detail.worktree} />
      </p>

      <h3 style={{ marginTop: "1rem" }}>Recent commits (branch)</h3>
      <ul className="dash3d-list">
        {detail.branchCommits.length ? (
          detail.branchCommits.map((c) => (
            <li key={c.sha} className="dash3d-mono">
              {c.sha} · {c.subject || NO_SOURCE}
              <br />
              <span className="dash3d-muted">{formatWat(c.date)}</span>
            </li>
          ))
        ) : (
          <li className="dash3d-muted">{NO_SOURCE}</li>
        )}
      </ul>

      <h3 style={{ marginTop: "1rem" }}>Lock commits</h3>
      <ul className="dash3d-list" data-testid="detail-lock-commits">
        {detail.lockCommits.length ? (
          detail.lockCommits.map((c) => (
            <li key={c} className="dash3d-mono">{c}</li>
          ))
        ) : (
          <li className="dash3d-muted">{NO_SOURCE}</li>
        )}
      </ul>

      <h3 style={{ marginTop: "1rem" }}>Lock history</h3>
      <ul className="dash3d-list" data-testid="detail-lock-history">
        {detail.lockHistory.length ? (
          detail.lockHistory.map((h) => (
            <li key={`${h.kind}-${h.atMs}-${h.label}`} className="dash3d-mono">
              {h.kind.replace("lock_", "")} · {h.label}
              <br />
              <span className="dash3d-muted">{formatWat(h.atIso)}</span>
            </li>
          ))
        ) : (
          <li className="dash3d-muted">{NO_SOURCE}</li>
        )}
      </ul>

      <h3 style={{ marginTop: "1rem" }}>Queue items</h3>
      <ul className="dash3d-list">
        {detail.queueItems.length ? (
          detail.queueItems.map((q) => (
            <li key={q.index}>
              #{q.index} {q.title} · {q.status}
              <span className="dash3d-muted dash3d-mono"> · {q.detail || NO_SOURCE}</span>
            </li>
          ))
        ) : (
          <li className="dash3d-muted">{NO_SOURCE}</li>
        )}
      </ul>

      <h3 style={{ marginTop: "1rem" }}>Notion pages</h3>
      <ul className="dash3d-list">
        {detail.notionPages.length ? (
          detail.notionPages.map((p) => (
            <li key={p.id}>
              <a className="dash3d-pill" href={p.url} target="_blank" rel="noreferrer">
                {sanitizeNotionPlainText(p.title || p.id, 120) || p.id}
              </a>
              <span className="dash3d-muted" style={{ display: "block", fontSize: "0.72rem" }}>
                {(sanitizeNotionPlainText(p.excerpt || "", 160) || NO_SOURCE).slice(0, 160)}
              </span>
            </li>
          ))
        ) : (
          <li className="dash3d-muted">{NO_SOURCE}</li>
        )}
      </ul>

      <h3 style={{ marginTop: "1rem" }}>Connections</h3>
      <ul className="dash3d-list">
        {detail.connections.length ? (
          detail.connections.map((c) => (
            <li key={`${c.kind}:${c.id}`}>
              <span className="dash3d-muted dash3d-mono">{c.kind}</span> · {c.name}
            </li>
          ))
        ) : (
          <li className="dash3d-muted">{NO_SOURCE}</li>
        )}
      </ul>

      <h3 style={{ marginTop: "1rem" }}>API spend</h3>
      <p className="dash3d-muted" style={{ fontSize: "0.78rem" }}>
        {spend == null ? NO_SOURCE : spend.available ? spend.summary : spend.reason || NO_SOURCE}
      </p>

      <h3 style={{ marginTop: "1rem" }}>Notes</h3>
      <pre className="dash3d-mono dash3d-muted" style={{ whiteSpace: "pre-wrap", margin: "0.35rem 0 0", fontSize: "0.72rem" }}>
        {detail.notes || NO_SOURCE}
      </pre>
    </>
  );
}

export function NodeDetailPanel({
  bot,
  notionPage,
  open,
  onClose,
  spend,
  status,
  notionNeighbors,
  portraitSrc,
  nhopDepth = 0,
  onNhopDepth,
}: {
  bot: BotNode | null;
  notionPage: NotionSnapPage | null;
  open: boolean;
  onClose: () => void;
  spend?: SpendView | null;
  status?: DashboardStatus | null;
  notionNeighbors?: NotionSnapPage[];
  portraitSrc?: string | null;
  /** Gap#55: controlled local-graph depth (0 = expand all). */
  nhopDepth?: number;
  onNhopDepth?: (depth: number) => void;
}) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const openPanel = Boolean(open && (bot || notionPage));

  useEffect(() => {
    if (!openPanel) return;
    // Gap#46/#54: remember opener and move focus into the dialog.
    const prev = document.activeElement;
    if (prev instanceof HTMLElement && !panelRef.current?.contains(prev)) {
      restoreFocusRef.current = prev;
    }
    closeBtnRef.current?.focus();
  }, [openPanel, bot?.id, notionPage?.id]);

  useEffect(() => {
    if (!openPanel) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = (): HTMLElement[] =>
      Array.from(
        panel.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node): node is HTMLElement => {
        if (!(node instanceof HTMLElement)) return false;
        return node.offsetParent !== null || node === closeBtnRef.current;
      });

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        const restore = restoreFocusRef.current;
        onClose();
        // Restore after close paints (Gap#54).
        queueMicrotask(() => restore?.focus?.());
        return;
      }
      if (ev.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (ev.shiftKey) {
        if (active === first || !panel.contains(active)) {
          ev.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        ev.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [openPanel, onClose]);

  const detail =
    bot && status
      ? buildBotDetailView({
          bot,
          bots: status.bots,
          commits: status.commits,
          constellations: status.constellations,
          constellationEdges: status.constellationEdges,
          notionGraph: status.notionGraph,
          fleetPlan: status.fleetPlan,
          timeline: status.timeline,
        })
      : null;

  const depthValue = Number.isFinite(nhopDepth) ? Math.max(0, Math.min(3, Math.floor(nhopDepth))) : 0;

  const nhopControls =
    bot ? (
      <div className="dash3d-nhop" data-testid="nhop-controls">
        <label className="dash3d-muted" style={{ fontSize: "0.68rem" }}>
          Local graph depth
          <input
            type="range"
            min={0}
            max={3}
            step={1}
            value={depthValue}
            data-testid="nhop-depth"
            onChange={(e) => {
              const depth = Number(e.target.value) || 0;
              onNhopDepth?.(depth);
              document.dispatchEvent(
                new CustomEvent("dash3d-nhop", {
                  detail: { botId: bot.id, depth, isolate: depth > 0 },
                }),
              );
            }}
          />
        </label>
        <button
          type="button"
          className="dash3d-pill"
          data-testid="nhop-clear"
          onClick={() => {
            onNhopDepth?.(0);
            document.dispatchEvent(new CustomEvent("dash3d-nhop", { detail: { botId: null, depth: 0, isolate: false } }));
          }}
        >
          Expand all
        </button>
      </div>
    ) : null;

  return (
    <aside
      ref={(el) => { panelRef.current = el; }}
      className={`dash3d-side dash3d-node-detail ${open && (bot || notionPage) ? "is-open" : ""}`}
      aria-hidden={!open}
      role={open && (bot || notionPage) ? "dialog" : undefined}
      aria-modal={open && (bot || notionPage) ? true : undefined}
      aria-labelledby={open ? "dash3d-node-detail-title" : undefined}
      data-testid="node-detail"
      data-dash3d-node={bot?.id ?? notionPage?.id ?? undefined}
    >
      <div className="dash3d-glass dash3d-node-card">
        <button
          type="button"
          ref={closeBtnRef}
          className="dash3d-side-close"
          onClick={() => {
            const restore = restoreFocusRef.current;
            onClose();
            queueMicrotask(() => restore?.focus?.());
          }}
          aria-label="Close details"
        >
          ×
        </button>
        {detail ? <BotDetailBody detail={detail} spend={spend} portraitSrc={portraitSrc} /> : null}
        {!detail && bot ? (
          <p className="dash3d-muted">Detail data {NO_SOURCE}</p>
        ) : null}

        {/* Gap#55: N-hop for every bot, not only those with a Notion page. */}
        {bot ? nhopControls : null}

        {notionPage ? (
          <>
            <h2 id={bot ? undefined : "dash3d-node-detail-title"} style={{ marginTop: bot ? "1.25rem" : 0 }}>Notion page</h2>
            <p className="dash3d-title">{sanitizeNotionPlainText(notionPage.title, 160) || NO_SOURCE}</p>
            <p className="dash3d-muted" style={{ fontSize: "0.78rem" }}>
              {sanitizeNotionPlainText(notionPage.excerpt, 400) || NO_SOURCE}
            </p>
            <p className="dash3d-mono dash3d-muted" style={{ marginTop: "0.5rem" }}>
              <Field label="kind" value={notionPage.kind} />
              <Field label="edited" value={notionPage.lastEdited ? formatWat(notionPage.lastEdited) : null} />
              <Field label="id" value={notionPage.id} />
            </p>

            <h3 style={{ marginTop: "0.75rem" }}>Linked neighbors</h3>
            <ul className="dash3d-list">
              {notionNeighbors && notionNeighbors.length ? (
                notionNeighbors.map((n) => (
                  <li key={n.id}>
                    <a className="dash3d-pill" href={n.url} target="_blank" rel="noreferrer">
                      {sanitizeNotionPlainText(n.title, 120) || n.id}
                    </a>
                  </li>
                ))
              ) : (
                <li className="dash3d-muted">{NO_SOURCE}</li>
              )}
            </ul>
            <a
              className="dash3d-pill"
              href={notionPage.url}
              target="_blank"
              rel="noreferrer"
              style={{ marginTop: "0.5rem", display: "inline-flex" }}
            >
              Open in Notion
            </a>
          </>
        ) : null}
      </div>
    </aside>
  );
}

/** Helper for app: resolve neighbor pages from graph + selected id. */
export function resolveNotionNeighbors(
  status: DashboardStatus | null | undefined,
  pageId: string | null | undefined,
): NotionSnapPage[] {
  if (!status || !pageId) return [];
  const ids = notionNeighborIds(status.notionGraph, pageId);
  const byId = new Map(status.notionGraph.pages.map((p) => [p.id, p] as const));
  return ids.map((id) => byId.get(id)).filter((p): p is NotionSnapPage => Boolean(p));
}
