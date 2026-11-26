import { useEffect, useState } from "react";
import { addCustomAgent, editBot, toolCatalog, type AgentDefinition, type DeploymentRecord, type BotDraft } from "@/lib/mind/fleet";
import { BOT_PROVIDERS } from "@/lib/mind/bot-model";
import { normalizeBotKnowledge } from "@/lib/mind/bot-model";
import { MODEL_TIERS } from "@/lib/mind/model-tiers";
import { MAX_CUSTOM_PERSONALITY_CHARS } from "@/lib/mind/personalities";
import type { Workspace } from "@/lib/mind/types";

const fields = "mt-1 min-h-11 w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm";
const secondary = "bot-control min-h-11 rounded-panel border px-3 text-sm";
const primary = "bot-control bot-control--primary min-h-11 rounded-panel border px-4 text-sm font-semibold";
const blank = (): BotDraft => ({ name: "", description: "", instructions: "", tools: ["list_projects"], projectId: null });

export function BotBuilder({ ws, setWs, onChat, onRun, onSchedule, onSelect, focusBotId, onDeploy, onPin, catalogModels = [] }: {
  ws: Workspace;
  setWs: (fn: (prev: Workspace) => Workspace) => void;
  onChat?: (id: string, newThread?: boolean) => void;
  onRun?: (id: string) => void;
  onSchedule?: (id: string) => void;
  onSelect?: (id: string) => void;
  focusBotId?: string | null;
  onDeploy?: (id: string, target: DeploymentRecord["target"]) => void;
  onPin?: (id: string) => void;
  catalogModels?: { id: string; label: string }[];
}) {
  const [draft, setDraft] = useState<BotDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [telegram, setTelegram] = useState("");
  useEffect(() => {
    if (focusBotId && ws.agents.some((bot) => bot.id === focusBotId && bot.archived)) setShowArchived(true);
  }, [focusBotId, ws.agents]);
  const tools = toolCatalog();
  const active = ws.agents.filter((bot) => !bot.archived);
  const archived = ws.agents.filter((bot) => bot.archived);

  function start(bot?: AgentDefinition, duplicate = false) {
    setEditingId(bot && !duplicate ? bot.id : null);
    setDraft(bot ? {
      name: duplicate ? `${bot.name.slice(0, 75)} copy` : bot.name,
      description: bot.description,
      instructions: bot.instructions,
      tools: [...bot.tools],
      projectId: bot.projectId,
      chatProvider: bot.chatProvider ?? null,
      chatTier: bot.chatTier ?? null,
      knowledge: bot.knowledge ?? "",
    } : blank());
    setError("");
    setChecked(false);
  }

  function change(patch: Partial<BotDraft>) {
    setDraft((current) => current && { ...current, ...patch });
    setChecked(false);
    setError("");
  }

  function save() {
    if (!draft) return;
    const result = editingId ? editBot(ws, editingId, draft) : addCustomAgent(ws, draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setWs((prev) => ({
      ...prev,
      agents: editingId ? prev.agents.map((bot) => bot.id === editingId ? result.agent : bot) : [result.agent, ...prev.agents],
    }));
    setStatus(`${result.agent.name} saved.`);
    setDraft(null);
  }

  function setArchived(bot: AgentDefinition, value: boolean) {
    setWs((prev) => ({
      ...prev,
      agents: prev.agents.map((item) => item.id === bot.id ? { ...item, archived: value, updatedAt: new Date().toISOString() } : item),
    }));
    setArchiveId(null);
    setStatus(`${bot.name} ${value ? "archived" : "restored"}.`);
  }

  return (
    <section aria-labelledby="bot-builder-title" className="bot-builder space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="bot-builder-title" className="font-display text-xl font-semibold">Your bots</h3>
        {!draft && <button className={primary} type="button" onClick={() => start()}>Create bot</button>}
      </div>
      <p data-testid="owned-bot-note" className="text-sm">Create bot saves an Adrian-owned bot on this device. It does not need Paperclip. Telegram is a name until you paste that bot’s token. Nothing is sent before that.</p>
      {status && <p role="status" className="text-sm text-fg">{status}</p>}
      {draft && (
        <form aria-label={editingId ? "Edit bot" : "Create bot"} className="bot-builder-card space-y-4 p-4" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <fieldset className="space-y-3">
            <legend className="font-semibold">Identity and instructions</legend>
            <label className="block text-sm">Bot name<input required maxLength={80} value={draft.name} autoFocus onChange={(event) => change({ name: event.target.value })} className={fields} /></label>
            <label className="block text-sm">Purpose <span className="text-muted">(optional)</span><input maxLength={400} value={draft.description} onChange={(event) => change({ description: event.target.value })} className={fields} /></label>
            <label className="block text-sm">Telegram username <span className="text-muted">(optional)</span><input aria-label="Telegram bot username" maxLength={64} value={telegram} onChange={(event) => setTelegram(event.target.value)} placeholder="@yourbot" className={fields} /></label>
            <label className="block text-sm">Instructions<textarea aria-describedby="bot-instruction-limit" maxLength={MAX_CUSTOM_PERSONALITY_CHARS} rows={4} value={draft.instructions} onChange={(event) => change({ instructions: event.target.value })} className={fields} /></label>
            <p id="bot-instruction-limit" className="text-xs text-muted">{draft.instructions.length} / {MAX_CUSTOM_PERSONALITY_CHARS} characters in a bot conversation.</p>
          </fieldset>
          <label className="block text-sm">Project context
            <select value={draft.projectId ?? ""} onChange={(event) => change({ projectId: event.target.value || null })} className={fields}>
              <option value="">No project</option>
              {ws.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-muted">Picking a project scopes local run reads to that project.</span>
          </label>
          <label className="block text-sm">Chat provider
            <select aria-label="Chat provider" value={draft.chatProvider ?? ""} onChange={(event) => {
              const allowed = ["nemotron", "ollama", ...BOT_PROVIDERS, ...catalogModels.map((item) => item.id)];
              change({ chatProvider: allowed.includes(event.target.value) ? event.target.value as BotDraft["chatProvider"] : null });
            }} className={fields}>
              <option value="">Use Chat’s selected provider</option>
              {BOT_PROVIDERS.map((id) => <option key={id} value={id}>{id}</option>)}
              <option value="nemotron">Nemotron</option>
              <option value="ollama">Local model</option>
              {catalogModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="block text-sm">Chat tier
            <select aria-label="Chat tier" value={draft.chatTier ?? ""} onChange={(event) => change({ chatTier: (MODEL_TIERS as readonly string[]).includes(event.target.value) ? event.target.value as BotDraft["chatTier"] : null })} className={fields}>
              <option value="">Use Chat’s selected tier</option>
              {MODEL_TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
            </select>
            <span className="mt-1 block text-xs text-muted">A saved choice applies to a new conversation. An existing conversation keeps its own.</span>
          </label>
          <label className="block text-sm">Knowledge note
            <textarea aria-label="Knowledge note" rows={3} maxLength={4000} value={draft.knowledge ?? ""} onChange={(event) => change({ knowledge: event.target.value })} className={fields} />
            <span className="mt-1 block text-xs text-muted">A text note is copied into a new chat. A key-shaped note is not saved. An existing chat is not changed.</span>
          </label>
          <label className="block text-sm">Load a text file
            <input aria-label="Load a text file" type="file" accept="text/plain,.txt,.md" className={fields} onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const named = /\.(txt|md)$/i.test(file.name);
              const typed = !file.type || file.type === "text/plain" || file.type === "text/markdown" || file.type === "text/x-markdown";
              if (!named || !typed || file.size > 4000) {
                setError("Only a small text file can be loaded. Nothing was saved.");
                return;
              }
              void file.text().then((text) => {
                const checked = normalizeBotKnowledge(text);
                if (checked.rejected) {
                  setError(checked.rejected);
                  return;
                }
                change({ knowledge: checked.knowledge });
              });
            }} />
          </label>
          <fieldset className="space-y-2">
            <legend className="font-semibold">Run capabilities</legend>
            <p className="text-sm text-muted">These tools apply to queued runs. They do not change the chat provider.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {tools.map((tool) => (
                <label key={tool.id} className="flex min-h-11 items-start gap-3 rounded-panel border border-line p-3 text-sm">
                  <input type="checkbox" checked={draft.tools.includes(tool.id)} onChange={(event) => change({ tools: event.target.checked ? [...draft.tools, tool.id] : draft.tools.filter((id) => id !== tool.id) })} />
                  <span className="min-w-0"><span className="block font-medium">{tool.name}</span><span className="block text-xs text-muted">{tool.reason}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          {checked && <p role="status" className="text-sm text-muted">{draft.tools.length} selected · {tools.filter((tool) => draft.tools.includes(tool.id) && tool.available).length} available in the local worker. This check does not run the bot.</p>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary} disabled={!draft.name.trim() || !draft.tools.length || draft.instructions.length > MAX_CUSTOM_PERSONALITY_CHARS}>Save bot</button>
            <button type="button" className={secondary} onClick={() => setChecked(true)}>Check capabilities</button>
            <button type="button" className={secondary} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      )}
      {active.length === 0 && <p className="text-sm text-muted">Create a bot or start from a template.</p>}
      <ul className="grid gap-3 lg:grid-cols-2">
        {active.map((bot) => {
          const scheduled = ws.schedules.filter((job) => job.agentId === bot.id && job.enabled).length;
          const deployment = ws.deployments.find((item) => item.agentId === bot.id && item.agentVersion === bot.version);
          return <li key={bot.id} id={`bot-${bot.id}`} tabIndex={-1} className="bot-builder-card min-w-0 space-y-3 p-4">
            <div className="flex items-start gap-3" onClick={(event) => {
              if ((event.target as HTMLElement).closest("button, summary, input, a, label")) return;
              onSelect?.(bot.id);
            }}>
              <img src="/brand/logo-mark.jpg" alt="" width={32} height={32} className="shrink-0 rounded-lg" />
              <div className="min-w-0">
                <h4 className="break-words font-semibold">{bot.name}</h4>
                <p className="break-words text-sm text-muted">{bot.description}</p>
                <p className="mt-1 text-xs text-muted">Version {bot.version} · {bot.tools.length} run tools{scheduled > 0 ? ` · ${scheduled} enabled schedules` : ""}</p>
                <p className="mt-1 text-xs text-muted">{bot.chatProvider || bot.chatTier ? `New chats use ${bot.chatProvider ?? "Chat’s provider"} · ${bot.chatTier ?? "Chat’s tier"}` : "New chats use Chat’s selected model."}</p>
                {bot.knowledge ? <p className="mt-1 text-xs text-muted">New chats copy this note.</p> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {onChat && <button type="button" className={primary} onClick={() => onChat(bot.id)}>Open chat</button>}
              {onRun && <button type="button" className={secondary} onClick={() => onRun(bot.id)}>Run task</button>}
              {onSchedule && <button type="button" className={secondary} onClick={() => onSchedule(bot.id)}>Schedule</button>}
            </div>
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center text-sm">Manage {bot.name}</summary>
              <div className="flex flex-wrap gap-2">
                {onChat && <button type="button" className={secondary} onClick={() => onChat(bot.id, true)}>New conversation</button>}
                <button type="button" className={secondary} onClick={() => start(bot)}>Edit bot</button>
                <button type="button" className={secondary} onClick={() => start(bot, true)}>Duplicate</button>
                {onPin && <button type="button" className={secondary} onClick={() => onPin(bot.id)}>{ws.pins.some((pin) => pin.kind === "agent" && pin.ref === bot.id) ? "Unpin" : "Pin"}</button>}
                {onDeploy && <button type="button" className={secondary} onClick={() => onDeploy(bot.id, "local-worker")}>Arm local worker</button>}
                {onDeploy && <button type="button" className={secondary} onClick={() => onDeploy(bot.id, "hosted-worker")}>Record hosted target</button>}
                <button type="button" className={secondary} onClick={() => setArchiveId(bot.id)}>Archive</button>
              </div>
              <p id={deployment ? `deployment-${deployment.id}` : undefined} tabIndex={-1} className="mt-2 text-xs text-muted">{deployment ? `${deployment.target} · ${deployment.state}${deployment.error ? ` · ${deployment.error}` : ""}` : "No worker target recorded for this version."}</p>
              <p className="mt-1 text-xs text-muted">Instruction changes apply to new conversations. Existing conversations keep their own settings.</p>
              {archiveId === bot.id && <div className="mt-2 space-y-2 text-sm">
                <p>{scheduled ? `${scheduled} enabled schedule(s) will be blocked while this bot is archived.` : "This bot will be hidden from active bots."} Existing conversations and run history are kept.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={secondary} onClick={() => setArchived(bot, true)}>Confirm archive</button>
                  <button type="button" className={secondary} onClick={() => setArchiveId(null)}>Cancel archive</button>
                </div>
              </div>}
            </details>
          </li>;
        })}
      </ul>
      {archived.length > 0 && <>
        <button type="button" className={secondary} aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Hide archived" : `Archived bots (${archived.length})`}</button>
        {showArchived && <ul className="space-y-2">{archived.map((bot) => <li key={bot.id} id={`bot-${bot.id}`} className="flex flex-wrap items-center gap-3 text-sm"><span>{bot.name}</span><button type="button" className={secondary} onClick={() => setArchived(bot, false)}>Restore {bot.name}</button></li>)}</ul>}
      </>}
    </section>
  );
}
