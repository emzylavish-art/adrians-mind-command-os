import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BotNode, Health } from "@/lib/mind/dashboard/types";
import type { CityBuilding } from "@/lib/mind/dashboard/city-layout";
import type { NotionSnapPage } from "@/lib/mind/dashboard/notion-graph-core";
import {
  DEFAULT_PREFS,
  buildOperatorTargets,
  filterOperatorTargets,
  formatBotClipboardSummary,
  readOperatorPrefs,
  shouldIgnoreOperatorHotkey,
  writeOperatorPrefs,
  type OperatorLayers,
  type OperatorPrefs,
  type OperatorTarget,
} from "@/lib/mind/dashboard/operator-palette";
import { sendFly } from "./flyover-hud";

type Props = {
  bots: BotNode[];
  buildings: CityBuilding[];
  pages: NotionSnapPage[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: OperatorPrefs;
  onPrefsChange: (prefs: OperatorPrefs) => void;
  onFlyBot: (botId: string) => void;
  onOpenNotion: (pageId: string) => void;
  onSelectBot: (bot: BotNode) => void;
};

const HEALTHS: Array<Health | "all"> = ["all", "healthy", "stalled", "blocked", "idle"];

export function OperatorConsole({
  bots,
  buildings,
  pages,
  open,
  onOpenChange,
  prefs,
  onPrefsChange,
  onFlyBot,
  onOpenNotion,
  onSelectBot,
}: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const targets = useMemo(
    () =>
      filterOperatorTargets(
        buildOperatorTargets({ bots, buildings, pages, healthFilter: prefs.healthFilter }),
        query,
      ),
    [bots, buildings, pages, prefs.healthFilter, query],
  );

  useEffect(() => {
    setActive(0);
  }, [query, prefs.healthFilter, open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const runTarget = useCallback(
    (t: OperatorTarget) => {
      if (t.kind === "bot" && t.botId) {
        const bot = bots.find((b) => b.id === t.botId);
        onFlyBot(t.botId);
        if (bot) onSelectBot(bot);
        onPrefsChange({ ...prefs, lastNodeId: t.id, lastNodeKind: "bot" });
      } else if (t.kind === "building" && t.buildingId) {
        sendFly({ type: "DIVE" });
        setTimeout(() => sendFly({ type: "ENTER", buildingId: t.buildingId!, part: "door" }), 80);
        onPrefsChange({ ...prefs, lastNodeId: t.id, lastNodeKind: "building" });
      } else if (t.kind === "notion" && t.pageId) {
        onOpenNotion(t.pageId);
        document.dispatchEvent(new CustomEvent("dash3d-focus-notion", { detail: { pageId: t.pageId } }));
        onPrefsChange({ ...prefs, lastNodeId: t.id, lastNodeKind: "notion" });
      }
      onOpenChange(false);
    },
    [bots, onFlyBot, onOpenNotion, onOpenChange, onPrefsChange, onSelectBot, prefs],
  );

  const copyBot = useCallback(async () => {
    const t = targets[active];
    const bot = t?.botId ? bots.find((b) => b.id === t.botId) : bots[0];
    if (!bot) return;
    const text = formatBotClipboardSummary(bot);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }, [active, bots, targets]);

  const setLayer = (key: keyof OperatorLayers, value: boolean) => {
    onPrefsChange({ ...prefs, layers: { ...prefs.layers, [key]: value } });
  };

  if (!open) return null;

  return (
    <div className="dash3d-operator-root" data-testid="operator-console" role="dialog" aria-modal="true" aria-labelledby="dash3d-operator-title" aria-label="Operator console">
      <button type="button" className="dash3d-operator-backdrop" aria-label="Close operator" onClick={() => onOpenChange(false)} />
      <div className="dash3d-glass dash3d-operator-panel">
        <div className="dash3d-operator-head">
          <h2 id="dash3d-operator-title">Operator</h2>
          <p className="dash3d-muted" style={{ fontSize: "0.65rem" }}>
            Cmd/Ctrl-K · Esc closes · no shell / no lock writes
          </p>
        </div>
        <input
          ref={inputRef}
          className="dash3d-operator-input"
          data-testid="operator-query"
          placeholder="Fly to bot, building, or Notion page…"
          value={query}
          onChange={(e) => setQuery(e.target.value.slice(0, 80))}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onOpenChange(false);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(targets.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const t = targets[active];
              if (t) runTarget(t);
            }
          }}
        />
        <ul className="dash3d-operator-list" role="listbox" aria-label="Results">
          {targets.length === 0 ? (
            <li className="dash3d-muted" style={{ padding: "0.4rem" }}>
              no source yet
            </li>
          ) : (
            targets.map((t, i) => (
              <li key={t.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`dash3d-operator-row${i === active ? " is-active" : ""}`}
                  data-testid="operator-row"
                  data-kind={t.kind}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => runTarget(t)}
                >
                  <span className="dash3d-feed-kind">{t.kind}</span>
                  <span className="dash3d-operator-row-body">
                    <span>{t.label}</span>
                    <span className="dash3d-muted" style={{ fontSize: "0.65rem" }}>
                      {t.sub}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="dash3d-operator-filters" aria-label="Health filter">
          {HEALTHS.map((h) => (
            <button
              key={h}
              type="button"
              className={`dash3d-pill${prefs.healthFilter === h ? " is-on" : ""}`}
              data-testid={`operator-health-${h}`}
              aria-pressed={prefs.healthFilter === h}
              onClick={() => onPrefsChange({ ...prefs, healthFilter: h })}
            >
              {h}
            </button>
          ))}
        </div>
        <div className="dash3d-operator-layers" aria-label="Layer toggles">
          {(Object.keys(prefs.layers) as Array<keyof OperatorLayers>).map((k) => (
            <label key={k} className="dash3d-operator-layer">
              <input
                type="checkbox"
                checked={prefs.layers[k]}
                data-testid={`operator-layer-${k}`}
                onChange={(e) => setLayer(k, e.target.checked)}
              />
              {k}
            </label>
          ))}
        </div>
        <div className="dash3d-operator-actions">
          <button type="button" className="dash3d-pill" data-testid="operator-copy" onClick={() => void copyBot()}>
            {copied ? "Copied" : "Copy bot lock/branch"}
          </button>
          <button type="button" className="dash3d-pill" onClick={() => onOpenChange(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function useOperatorHotkey(onToggle: () => void) {
  useEffect(() => {
    let lastToggleMs = 0;
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreOperatorHotkey(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        // Hacker: ignore repeat / double-fire within 300ms (OS key-repeat + some Bluetooth boards).
        const now = Date.now();
        if (now - lastToggleMs < 300) return;
        lastToggleMs = now;
        onToggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggle]);
}

export function loadInitialOperatorPrefs(): OperatorPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_PREFS, layers: { ...DEFAULT_PREFS.layers } };
  return readOperatorPrefs(window.localStorage);
}

export function persistOperatorPrefs(prefs: OperatorPrefs) {
  if (typeof window === "undefined") return;
  writeOperatorPrefs(window.localStorage, prefs);
}
