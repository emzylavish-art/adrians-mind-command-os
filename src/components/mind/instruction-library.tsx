import { useEffect, useRef, useState } from "react";
import type { InstructionMetadata, InstructionPreferences } from "@/lib/mind/skill-instructions.server";
import { planSkillUse } from "@/lib/mind/skill-plan";

export function SkillPlanPreview({ manual, automatic, toolPermissions }: { manual: Record<string, boolean>; automatic?: Record<string, boolean>; toolPermissions?: Record<string, boolean> }) {
  const [objective, setObjective] = useState("");
  const plan = planSkillUse(objective, { manual, automatic, toolPermissions });
  return <section className="space-y-3 rounded-xl border border-white/10 p-4" aria-label="Skill plan preview">
    <h3 className="font-medium">Plan relevant procedures</h3>
    <input aria-label="Objective for skill plan" className="w-full rounded border border-white/15 bg-transparent px-3 py-2 text-sm" value={objective} maxLength={2000} onChange={(event) => setObjective(event.target.value)} placeholder="For example: compare projects, chats, and saved notes" />
    <p className="text-xs text-white/50">This bounded plan is a suggestion. It does not execute tools or grant access, spending authority, or action approval.</p>
    {plan.steps.map((step) => <div key={step.skillId} className="rounded border border-white/10 p-3 text-sm"><strong>{step.title}</strong> · {step.status}<p className="mt-1 text-xs text-white/60">{step.reason} Requires {step.requires.join(", ")}.</p>{step.blockedBy.map((reason) => <p key={reason} className="mt-1 text-xs text-amber-200">{reason}</p>)}</div>)}
    {[...plan.conflicts, ...plan.omitted].map((line) => <p key={line} className="text-xs text-white/60">{line}</p>)}
  </section>;
}

export function InstructionLibrary({ ownerKey, accessToken, agents = [] }: { ownerKey: string | null; accessToken?: string | null; agents?: { id: string; name: string }[] }) {
  const [catalog, setCatalog] = useState<InstructionMetadata[]>([]);
  const [preferences, setPreferences] = useState<InstructionPreferences>({});
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const headers = () => ({ ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), "content-type": "application/json" });
  async function load() {
    if (!ownerKey) return;
    const generation = ++epoch.current;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/mind/skills", { credentials: "same-origin", headers: headers() });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Instruction catalog is unavailable.");
      if (generation !== epoch.current) return;
      setCatalog(data.catalog); setPreferences(data.preferences); setRevision(data.revision); setHistory(data.history);
    } catch (caught) { if (generation === epoch.current) setError(caught instanceof Error ? caught.message : "Instruction catalog is unavailable."); }
    finally { if (generation === epoch.current) setBusy(false); }
  }
  useEffect(() => { epoch.current++; setCatalog([]); setPreferences({}); setHistory([]); setError(""); setNotice(""); void load(); return () => { epoch.current++; }; }, [ownerKey]);
  async function persist(next: Record<string, { enabled: boolean; agents: string[]; reviewedRevision: string }>, confirmation: string) {
    const generation = epoch.current;
    const serialized = Object.fromEntries(Object.entries(next).map(([id, value]) => [id, { enabled: value.enabled, agents: value.agents, reviewedRevision: value.reviewedRevision }]));
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/mind/skills", { method: "PUT", credentials: "same-origin", headers: headers(), body: JSON.stringify({ expectedRevision: revision, preferences: serialized }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Instruction assignment could not be saved.");
      if (generation !== epoch.current) return;
      setPreferences(data.preferences); setRevision(data.revision); setNotice(confirmation);
    } catch (caught) { if (generation === epoch.current) setError(caught instanceof Error ? caught.message : "Instruction assignment could not be saved."); }
    finally { if (generation === epoch.current) setBusy(false); }
  }
  async function save(entry: InstructionMetadata, form: HTMLFormElement) {
    const fields = new FormData(form);
    const next = { ...preferences, [entry.id]: { enabled: fields.get("enabled") === "on", agents: fields.getAll("agents").map(String), reviewedRevision: entry.revision } };
    await persist(next, `${entry.name}: reviewed revision saved. Future assigned conversation turns will load it; successful execution remains unverified.`);
  }
  async function removeMissing(id: string) {
    const next = Object.fromEntries(Object.entries(preferences).filter(([entryId]) => entryId !== id));
    await persist(next, `${id}: removed unavailable instruction assignments. Other reviewed revisions were preserved.`);
  }
  const missing = Object.keys(preferences).filter((id) => !catalog.some((entry) => entry.id === id));
  const identities = [{ id: "chat", name: "General chat" }, ...agents.filter((agent) => agent.id !== "chat")];
  return <section aria-label="Server instruction management" className="space-y-3 rounded-xl border border-white/10 p-4">
    <div className="flex justify-between gap-3"><h3 className="font-medium">Server instruction sets</h3><button disabled={busy} onClick={() => void load()} className="text-xs underline">Refresh</button></div>
    <p className="text-xs text-white/50">An instruction is a procedure, not a tool or an account connection. Review its exact revision, then assign it to conversation agents. Updated or removed instructions block new assigned turns until reviewed.</p>
    <input aria-label="Search server instructions" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search instructions" className="w-full rounded border border-white/15 bg-transparent px-3 py-2 text-sm" />
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}{notice && <p role="status" className="text-sm text-white/70">{notice}</p>}
    {missing.map((id) => <div key={id} className="rounded border border-amber-300/30 p-3 text-xs"><strong>{id} is no longer installed.</strong><p className="mt-1">Assigned new turns remain blocked until this unavailable assignment is removed or its instruction is restored and reviewed.</p><details className="mt-2"><summary>Previously reviewed content</summary><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap">{preferences[id].reviewedBody}</pre></details><button disabled={busy} onClick={() => void removeMissing(id)} className="mt-2 rounded border border-white/20 px-3 py-2">Remove unavailable assignments</button></div>)}
    {catalog.filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(query.toLowerCase())).map((entry) => {
      const preference = preferences[entry.id];
      return <details key={`${entry.id}-${revision}`} className="rounded-lg border border-white/10 p-3">
        <summary className="cursor-pointer text-sm">{entry.name} <span className="text-xs text-white/50">· {preference?.enabled ? "assigned" : "inactive"} · {entry.revision.slice(0, 12)}</span></summary>
        <p className="my-2 text-xs text-white/60">{entry.description}</p><p className="break-all text-xs text-white/40">{entry.origin}</p>
        <pre className="my-3 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-white/10 p-3 text-xs">{entry.body}</pre>
        {preference && preference.reviewedRevision !== entry.revision && <details className="mb-3 text-xs text-amber-200"><summary>Revision changed · compare previously reviewed instructions</summary><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap">{preference.reviewedBody}</pre></details>}
        <form onSubmit={(event) => { event.preventDefault(); void save(entry, event.currentTarget); }} className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={preference?.enabled ?? false} /> Enable this reviewed procedure</label>
          <fieldset className="space-y-1"><legend className="mb-1 text-xs text-white/60">Assigned conversation agents</legend>{identities.map((agent) => <label key={agent.id} className="flex items-center gap-2 text-xs"><input type="checkbox" name="agents" value={agent.id} defaultChecked={preference?.agents.includes(agent.id)} />{agent.name}</label>)}</fieldset>
          {preference?.agents.some((id) => !identities.some((agent) => agent.id === id)) && <p className="text-xs text-amber-200">Some former agent identities are unavailable. Saving removes those assignments.</p>}
          <button type="submit" disabled={busy} className="rounded border border-white/20 px-3 py-2 text-xs">Save reviewed revision and assignments</button>
        </form>
      </details>;
    })}
    <details className="text-sm"><summary className="cursor-pointer">Recent instruction dispatches ({history.length})</summary><p className="my-2 text-xs text-white/50">Loaded means the exact instruction text was included in a request. Procedure completion is unverified.</p>{history.map((item) => <p key={String(item.execution_id)} className="my-2 text-xs text-white/70">{String(item.skill_id)} · revision {String(item.skill_revision).slice(0, 12)} · agent {String(item.agent_id)} · {String(item.status)} · {String(item.created_at)}</p>)}</details>
  </section>;
}
