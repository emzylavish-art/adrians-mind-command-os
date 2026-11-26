import { type DictationMachineState } from "@/lib/mind/voice/dictation-machine";
import { DictationPill } from "@/components/mind/dictation-pill";
import { Mic } from "lucide-react";
import { COMPOSER_MODES, resolveSendPath, type ComposerModeId } from "@/lib/mind/composer-modes";
import { type ConsultModule } from "@/lib/mind/model-consult";
import { MODEL_TIERS, type ModelTier, type ModelTierCatalogRow } from "@/lib/mind/model-tiers";
import { type LogicRouteId, type LogicRoutePublic } from "@/lib/mind/logic-routes";

import { PRODUCT_LOGO } from "./chat-presentation";

/** Shared conversation controls. State and side effects remain with the session owner. */

export function BrowserDictationControl(props: {
  state: DictationMachineState["phase"];
  level: number;
  elapsedSec: number;
  disabled?: boolean;
  compact?: boolean;
  onMicClick: () => void;
  onStop: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-2" data-testid="browser-dictation" title="Browser speech, not a realtime voice session">
      <DictationPill
        state={props.state}
        level={props.level}
        elapsedSec={props.elapsedSec}
        disabled={props.disabled}
        onMicClick={props.onMicClick}
        onStop={props.onStop}
        onCancel={props.onCancel}
      />
      {props.compact ? (
        <span className="sr-only">Browser speech, not a realtime voice session.</span>
      ) : (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Browser speech</span>
      )}
    </div>
  );
}

export function VoiceModeButton(props: { onClick: () => void; pressed?: boolean; compact?: boolean }) {
  return (
    <button
      type="button"
      className={
        props.compact
          ? `focus-ring grid size-9 place-items-center rounded-full ${props.pressed ? "bg-accent text-accent-ink" : "text-muted"}`
          : `inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm ${props.pressed ? "bg-accent text-accent-ink" : "text-muted"}`
      }
      onClick={props.onClick}
      aria-label="Open voice mode"
      aria-pressed={props.pressed ?? false}
      data-testid="open-voice-mode"
      title="Realtime voice session. Not browser dictation."
    >
      <Mic className="size-4" />
      {props.compact ? <span className="sr-only">Voice mode</span> : "Voice mode"}
    </button>
  );
}

export function ComposerEffortControl({
  mode,
  onChoose,
  consultModules = [],
  consultModel = "",
  onConsultModel,
  consultHelpers = [],
  onConsultHelper,
}: {
  mode: ComposerModeId;
  onChoose: (mode: ComposerModeId) => void;
  consultModules?: ConsultModule[];
  consultModel?: string;
  onConsultModel?: (id: string) => void;
  consultHelpers?: string[];
  onConsultHelper?: (id: string) => void;
}) {
  const resolved = resolveSendPath(mode);
  const current = COMPOSER_MODES.find((item) => item.id === mode) ?? COMPOSER_MODES[0];
  const connected = consultModules.filter((item) => item.connected);
  return (
    <div className="composer-effort" data-testid="composer-effort">
      <label className="composer-effort-field">
        <span>Effort</span>
        <select value={mode} onChange={(event) => onChoose(event.target.value as ComposerModeId)}>
          {COMPOSER_MODES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <p className="composer-effort-description">
        {current?.detail}
        {resolved.notice ? ` ${resolved.notice}` : ""}
      </p>
      {mode === "orchestrator" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="orchestrator-models">
          <span className="text-xs text-muted">Orchestrator model</span>
          {connected.length === 0 ? <span className="text-xs text-muted">No model is connected right now. Connect one, then choose it.</span> : null}
          {connected.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid="consult-model"
              aria-pressed={consultModel === item.id}
              className={`min-h-11 rounded-full px-3 text-sm ${consultModel === item.id ? "bg-accent text-accent-ink tile-active" : "border border-line/80 bg-white/5 text-muted"}`}
              onClick={() => onConsultModel?.(item.id)}
            >
              {item.label}
            </button>
          ))}
          <fieldset className="w-full rounded-panel border border-line p-3"><legend className="px-1 text-xs">Helpers · explicitly selected</legend>
            <p className="mb-2 text-xs text-muted">Each selected helper receives the question and may incur a separate provider charge. The final answer uses the orchestrator above.</p>
            {connected.filter((item) => item.id !== consultModel).map((item) => <label key={item.id} className="mr-3 inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={consultHelpers.includes(item.id)} onChange={() => onConsultHelper?.(item.id)} />{item.label}</label>)}
            {!consultHelpers.length && <p className="text-xs text-muted">No helpers selected. Only the orchestrator will be called.</p>}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}

export function ModelTierPicker({
  name,
  tier,
  onChoose,
  logicRoute = null,
  logicRoutes = [],
  onChooseLogic,
  tierCatalog = [],
}: {
  name: string;
  tier: ModelTier;
  onChoose: (tier: ModelTier) => void;
  logicRoute?: LogicRouteId | null;
  logicRoutes?: LogicRoutePublic[];
  onChooseLogic?: (route: LogicRouteId) => void;
  tierCatalog?: readonly ModelTierCatalogRow[];
}) {
  return (
    <fieldset className="space-y-2">
     <legend className="text-sm font-semibold">Mode</legend>
      <p className="text-xs text-muted">These modes use the Grok key already saved on this computer.</p>
      {MODEL_TIERS.map((item) => {
        const readiness = tierCatalog.find(row => row.id === item);
        const blocked = readiness && !["unverified", "catalogued"].includes(readiness.availability);
        return <label key={item} className="flex items-start gap-2 text-sm" title={readiness?.note || "Model availability and inference are unverified."}>
          <input type="radio" name={name} checked={logicRoute == null && tier === item} disabled={Boolean(blocked)} onChange={() => { if (!blocked) onChoose(item); }} className="mt-1" />
          <span className="font-medium">{item}{readiness?.model ? ` · ${readiness.model}` : ""}<span className="block text-xs font-normal text-muted">{blocked ? readiness.note : readiness?.availability === "catalogued" ? "Listed in current catalogue; inference unverified" : "Availability checked before sending; inference unverified"}</span></span>
        </label>;
      })}
    </fieldset>
  );
}

export function ProviderPicker({
  name,
  choices,
  choice,
  onChoose,
  logicRoutes = [],
  grokVerified = false,
}: {
  name: string;
  choices: { id: string; label: string; enabled: boolean; reason: string }[];
  choice: string;
  onChoose: (id: string) => void;
  logicRoutes?: LogicRoutePublic[];
  grokVerified?: boolean;
}) {
  const visible = [
    ...choices,
    ...logicRoutes.filter((route) => route.ready).map((route) => ({ id: route.id, label: route.label, enabled: true, reason: route.reason })),
  ];
  const seen = new Set<string>();
  const groups = new Map<string, { title: string; items: typeof choices }>();
  for (const item of visible) {
    if (!item.enabled || seen.has(item.id)) continue;
    seen.add(item.id);
    const [kind, source] = item.id.split(":");
    const external = kind === "custom" || kind === "mcp";
    const groupId = external ? `${kind}:${source}` : kind === "service" ? "services" : item.id;
    const title = external ? item.label.split(": ")[0] : kind === "service" ? "Connected services" : item.label;
    const group = groups.get(groupId) ?? { title, items: [] };
    group.items.push(item);
    groups.set(groupId, group);
  }
  const selected = visible.find((item) => item.id === choice);
  return (
    <div className="provider-pack">
      <p className="text-sm font-semibold">Providers</p>
      <p className="mt-1 text-xs text-muted">{selected ? selected.label : "Choose a provider"}</p>
      {Array.from(groups, ([groupId, group]) => (
        <details key={groupId} className="provider-group" open={group.items.some((item) => item.id === choice) || undefined}>
          <summary className="flex items-center gap-2">
            {PRODUCT_LOGO[group.title.toLowerCase()] ? <img src={PRODUCT_LOGO[group.title.toLowerCase()]} alt="" width={16} height={16} className="size-4 rounded" /> : null}
            {group.title}
            {groupId.startsWith("custom:") ? <span className="text-xs text-muted">{group.items.length} {group.items.length === 1 ? "model" : "models"}</span> : null}
          </summary>
          <div className="max-h-64 overflow-y-auto overflow-x-hidden">
          {group.items.map((item) => (
            <label key={item.id} className={`flex items-start gap-2 rounded-xl px-2 py-2 text-sm ${choice === item.id ? "model-option-active" : ""} ${!item.enabled ? "opacity-60" : ""}`}>
              <input type="radio" name={name} className="mt-1" checked={choice === item.id} disabled={!item.enabled} onChange={() => { if (item.enabled) onChoose(item.id); }} />
              <span>
                {item.label}
                {item.id === "grok" && item.enabled ? <span className="text-muted"> · {grokVerified ? "A reply in this chat came from Grok" : "Configured"}</span> : null}
                <span className="block text-xs text-muted">{item.reason}</span>
              </span>
            </label>
          ))}
          </div>
        </details>
      ))}
    </div>
  );
}
