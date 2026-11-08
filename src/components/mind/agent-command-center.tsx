import { lazy, Suspense, useMemo, useState } from "react";
import {
  Activity, Bot, CheckCircle2, CircleAlert, Clock3, GitCommitHorizontal,
  LayoutDashboard, ListTodo, Network, RefreshCw, Search, ShieldCheck,
  Workflow, X,
} from "lucide-react";
import { useDashboardStatus } from "@/components/mind/dashboard-3d/use-dashboard-status";
import type { BotNode, Health } from "@/lib/mind/dashboard/types";

type Section = "Overview" | "Agents" | "Runs" | "Tasks" | "Activity" | "3D Map";

const Dashboard3D = lazy(() => import("@/components/mind/dashboard-3d/dashboard-app").then((m) => ({ default: m.DashboardApp })));

const sections: { id: Section; icon: typeof LayoutDashboard }[] = [
  { id: "Overview", icon: LayoutDashboard },
  { id: "Agents", icon: Bot },
  { id: "Runs", icon: Workflow },
  { id: "Tasks", icon: ListTodo },
  { id: "Activity", icon: Activity },
  { id: "3D Map", icon: Network },
];

const healthLabel: Record<Health, string> = {
  healthy: "Healthy",
  stalled: "Stalled",
  blocked: "Blocked",
  idle: "Idle",
};

function timeLabel(value?: string | null) {
  if (!value) return "No recorded activity";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function Stat({ label, value, note, icon: Icon }: { label: string; value: string | number; note: string; icon: typeof Bot }) {
  return <article className="rounded-2xl border border-white/[0.08] bg-[#111a27] p-5">
    <div className="flex items-center justify-between text-slate-400"><span className="text-sm">{label}</span><Icon size={18}/></div>
    <div className="mt-4 text-3xl font-semibold tracking-tight text-white">{value}</div>
    <p className="mt-2 text-xs text-slate-500">{note}</p>
  </article>;
}

function HealthPill({ health }: { health: Health }) {
  const styles: Record<Health, string> = {
    healthy: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    stalled: "border-amber-400/20 bg-amber-400/10 text-amber-200",
    blocked: "border-rose-400/20 bg-rose-400/10 text-rose-300",
    idle: "border-slate-400/20 bg-slate-400/10 text-slate-300",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${styles[health]}`}><i className="h-1.5 w-1.5 rounded-full bg-current"/>{healthLabel[health]}</span>;
}

function AgentRow({ bot, onSelect }: { bot: BotNode; onSelect: (bot: BotNode) => void }) {
  return <button onClick={() => onSelect(bot)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-left transition hover:border-white/20 hover:bg-white/[0.045] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
    <span className="min-w-0"><strong className="block truncate text-sm text-white">{bot.name}</strong><span className="mt-1 block truncate text-xs text-slate-500">{bot.lock?.notes || bot.reason || "No active task recorded"}</span></span>
    <span className="hidden min-w-0 truncate text-xs text-slate-500 sm:block">{bot.branch || "No branch assigned"}</span>
    <HealthPill health={bot.health}/>
  </button>;
}

export function AgentCommandCenter() {
  const { state, refresh } = useDashboardStatus();
  const [section, setSection] = useState<Section>("Overview");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<BotNode | null>(null);
  const data = state.status === "ready" ? state.data : null;
  const bots = data?.bots ?? [];
  const counts = useMemo(() => ({
    healthy: bots.filter((b) => b.health === "healthy").length,
    stalled: bots.filter((b) => b.health === "stalled").length,
    blocked: bots.filter((b) => b.health === "blocked").length,
    idle: bots.filter((b) => b.health === "idle").length,
  }), [bots]);
  const filteredBots = useMemo(() => bots.filter((b) => [b.name, b.id, b.branch, b.notes].join(" ").toLowerCase().includes(query.toLowerCase())), [bots, query]);
  const events = data?.timeline?.events ?? [];
  const recentEvents = [...events].reverse().slice(0, 12);
  const commits = data?.commits ?? [];
  const queue = data?.fleetPlan?.queue ?? [];
  const busy = state.status === "loading";

  return <main className="min-h-screen bg-[#080d14] text-slate-100">
    <div className="flex min-h-screen">
      <aside className="hidden w-[250px] shrink-0 flex-col border-r border-white/[0.07] bg-[#0b111a] px-4 py-5 lg:flex">
        <div className="flex items-center gap-3 px-2"><span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-600 text-white"><Network size={21}/></span><div><div className="text-sm font-bold tracking-wide text-white">ADRIAN'S MIND</div><div className="text-[10px] uppercase tracking-[.18em] text-slate-500">Agent command center</div></div></div>
        <div className="mt-8 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3"><div className="flex items-center gap-2 text-xs font-semibold text-slate-300"><span className={`h-2 w-2 rounded-full ${data ? "bg-emerald-400" : "bg-amber-400"}`}/>{data ? "System status connected" : "Connecting to system"}</div><p className="mt-2 text-[11px] leading-relaxed text-slate-500">{data ? `Live snapshot · updated ${timeLabel(data.generatedAt)}` : state.status === "error" ? state.error : "Loading agent and task telemetry."}</p></div>
        <div className="mt-7 px-2 text-[10px] font-semibold uppercase tracking-[.18em] text-slate-600">Command</div>
        <nav className="mt-3 space-y-1">{sections.map(({id,icon:Icon})=><button key={id} onClick={()=>{setSection(id);setSelected(null)}} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${section===id ? "bg-white/[0.09] font-semibold text-white ring-1 ring-white/[0.08]" : "text-slate-400 hover:bg-white/[0.04] hover:text-white"}`}><Icon size={17}/>{id}</button>)}</nav>
        <div className="mt-7 px-2 text-[10px] font-semibold uppercase tracking-[.18em] text-slate-600">Explore</div>
        <button onClick={()=>setSection("3D Map")} className="mt-3 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-400 hover:bg-white/[0.04] hover:text-white"><Network size={17}/>3D fleet map</button>
        <a href="/" className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 hover:bg-white/[0.04] hover:text-white"><Bot size={17}/>AI workspace</a>
        <div className="mt-auto rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><div className="flex items-center gap-2 text-xs text-slate-300"><ShieldCheck size={14}/> Operational visibility</div><p className="mt-1 text-[10px] leading-relaxed text-slate-600">Status is sourced from the connected agent, lock, Git, and queue telemetry. Missing sources remain unreported.</p></div>
      </aside>
      <section className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-[#080d14]/90 px-4 py-3 backdrop-blur-xl sm:px-7">
          <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-600 text-white lg:hidden"><Network size={18}/></div><div><div className="text-xs text-slate-500">Adrian's Mind / Command</div><div className="text-sm font-semibold text-white">{section}</div></div></div>
          <div className="flex items-center gap-2"><button onClick={()=>void refresh()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"><RefreshCw size={13} className={busy ? "animate-spin" : ""}/>Refresh</button><a href="/" className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500">Open AI workspace</a></div>
        </header>
        <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-7 sm:py-8">
          <nav className="flex gap-1 overflow-x-auto pb-1 lg:hidden">{sections.map(({id,icon:Icon})=><button key={id} onClick={()=>setSection(id)} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs ${section===id ? "bg-white/10 text-white" : "text-slate-400"}`}><Icon size={14}/>{id}</button>)}<button onClick={()=>setSection("3D Map")} className="shrink-0 rounded-lg px-3 py-2 text-xs text-slate-400">3D map</button></nav>
          <div className="flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-violet-300"><span className="h-1.5 w-1.5 rounded-full bg-violet-400"/> AI AGENT OPERATIONS</div><h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{section === "Overview" ? "Your agent fleet, at a glance." : section === "Agents" ? "Agents & workers" : section === "Runs" ? "Execution history" : section === "Tasks" ? "Task queue" : section === "3D Map" ? "3D fleet map" : "System activity"}</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">{section === "Overview" ? "Monitor agent health, active work, execution signals, and system readiness from one command surface." : "Live operational information from the Adrian's Mind runtime."}</p></div><div className="text-right text-xs text-slate-500">{data ? `Last updated ${timeLabel(data.generatedAt)}` : "Awaiting telemetry"}</div></div>
          {state.status === "error" && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-200">Dashboard data unavailable: {state.error}. Refresh to retry.</div>}
          {state.status === "loading" && !data && <div className="rounded-2xl border border-white/[0.08] bg-[#111a27] p-8 text-sm text-slate-400">Loading live agent telemetry…</div>}
          {data && <>
            {section === "3D Map" && <div className="relative min-h-[75vh] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d14]"><Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading 3D fleet graph…</div>}><Dashboard3D embedded /></Suspense></div>}
            {section === "Overview" && <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Registered agents" value={bots.length} note="Agents in current status snapshot" icon={Bot}/>
                <Stat label="Healthy" value={counts.healthy} note="Reporting healthy state" icon={CheckCircle2}/>
                <Stat label="Needs attention" value={counts.stalled + counts.blocked} note={`${counts.stalled} stalled · ${counts.blocked} blocked`} icon={CircleAlert}/>
                <Stat label="Recorded events" value={events.length} note="Observed timeline events" icon={Activity}/>
              </div>
              <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
                <section className="rounded-2xl border border-white/[0.08] bg-[#111a27] p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold text-white">Agent fleet</h2><p className="mt-1 text-xs text-slate-500">Current health and assignment signals</p></div><button onClick={()=>setSection("Agents")} className="text-xs font-semibold text-violet-300 hover:text-violet-200">View all agents →</button></div><div className="space-y-2">{bots.slice(0,7).map(bot=><AgentRow key={bot.id} bot={bot} onSelect={setSelected}/>)}{bots.length===0&&<p className="py-5 text-sm text-slate-500">No agents were returned by the status source.</p>}</div></section>
                <div className="space-y-5">
                  <section className="rounded-2xl border border-white/[0.08] bg-[#111a27] p-5"><h2 className="font-semibold text-white">Fleet health distribution</h2><p className="mt-1 text-xs text-slate-500">Counts from the live status snapshot</p><div className="mt-5 space-y-4">{(["healthy","stalled","blocked","idle"] as Health[]).map(h=>{const n=counts[h];const pct=bots.length?Math.round(n/bots.length*100):0;return <div key={h}><div className="mb-2 flex justify-between text-xs"><span className="text-slate-400">{healthLabel[h]}</span><strong className="text-slate-200">{n} <span className="font-normal text-slate-500">({pct}%)</span></strong></div><div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-violet-400" style={{width:`${pct}%`}}/></div></div>})}</div></section>
                  <section className="rounded-2xl border border-white/[0.08] bg-[#111a27] p-5"><h2 className="font-semibold text-white">System sources</h2><div className="mt-4 space-y-3 text-xs">{[{name:"Agent locks",ok:data.sources.locksOk},{name:"Git activity",ok:data.sources.gitOk},{name:"Notion graph",ok:data.notionGraph.available},{name:"Spend telemetry",ok:data.money?.available}].map(x=><div key={x.name} className="flex items-center justify-between"><span className="text-slate-400">{x.name}</span><span className={x.ok?"text-emerald-300":"text-slate-500"}>{x.ok?"Available":"No source"}</span></div>)}</div></section>
                </div>
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <section className="rounded-2xl border border-white/[0.08] bg-[#111a27] p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold text-white">Recent activity</h2><p className="mt-1 text-xs text-slate-500">Commits, claims, releases, and heartbeats</p></div><button onClick={()=>setSection("Activity")} className="text-xs text-violet-300">View activity →</button></div><div className="space-y-3">{recentEvents.slice(0,6).map((ev,i)=><div key={`${ev.atIso}-${ev.kind}-${i}`} className="flex gap-3 border-b border-white/[0.05] pb-3 last:border-0"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-violet-400"/><div className="min-w-0 flex-1"><p className="truncate text-xs text-slate-200">{ev.label}</p><p className="mt-1 text-[11px] text-slate-500">{ev.kind.replace("_"," ")} · {timeLabel(ev.atIso)}</p></div></div>)}{recentEvents.length===0&&<p className="text-sm text-slate-500">No timeline events recorded.</p>}</div></section>
                <section className="rounded-2xl border border-white/[0.08] bg-[#111a27] p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold text-white">Work queue</h2><p className="mt-1 text-xs text-slate-500">Items loaded from the fleet queue source</p></div><button onClick={()=>setSection("Tasks")} className="text-xs text-violet-300">View queue →</button></div>{data.fleetPlan.queueHead&&<div className="mb-3 rounded-xl border border-violet-400/20 bg-violet-400/[0.06] p-3"><div className="text-[10px] font-semibold uppercase tracking-wider text-violet-300">Next queued item</div><div className="mt-1 text-sm font-semibold text-white">{data.fleetPlan.queueHead.title}</div></div>}<div className="space-y-2">{queue.slice(0,6).map((item,i)=><div key={`${item.title}-${i}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.025] px-3 py-2"><span className="truncate text-xs text-slate-300">{item.title}</span><span className="shrink-0 text-[10px] text-slate-500">{item.status || "Queued"}</span></div>)}{queue.length===0&&<p className="text-sm text-slate-500">No queue items are available from the configured source.</p>}</div></section>
              </div>
            </>}
            {section === "Agents" && <section className="rounded-2xl border border-white/[0.08] bg-[#111a27] p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-white">Agent registry</h2><p className="mt-1 text-xs text-slate-500">{bots.length} agents in latest status snapshot</p></div><label className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2"><Search size={14} className="text-slate-500"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search agents" className="w-40 bg-transparent text-xs text-white outline-none placeholder:text-slate-600"/></label></div><div className="space-y-2">{filteredBots.map(bot=><AgentRow key={bot.id} bot={bot} onSelect={setSelected}/>)}{filteredBots.length===0&&<p className="py-6 text-center text-sm text-slate-500">No agents match that search.</p>}</div></section>}
            {section === "Runs" && <section className="rounded-2xl border border-white/[0.08] bg-[#111a27] p-5"><h2 className="font-semibold text-white">Observed execution timeline</h2><p className="mt-1 text-xs text-slate-500">This source records Git commits and agent lock transitions; it is not a complete tool-call audit log.</p><div className="mt-5 space-y-2">{recentEvents.map((ev,i)=><div key={`${ev.atIso}-${i}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-4 py-3"><div className="min-w-0"><div className="truncate text-sm text-slate-200">{ev.label}</div><div className="mt-1 text-[11px] text-slate-500">{ev.kind.replace("_"," ")}{ev.branch? ` · ${ev.branch}`:""}</div></div><span className="text-[11px] text-slate-500">{timeLabel(ev.atIso)}</span></div>)}{recentEvents.length===0&&<p className="py-6 text-sm text-slate-500">No observed run events available.</p>}</div></section>}
            {section === "Tasks" && <section className="rounded-2xl border border-white/[0.08] bg-[#111a27] p-5"><h2 className="font-semibold text-white">Fleet task queue</h2><p className="mt-1 text-xs text-slate-500">Read-only queue view. Queue mutations are not exposed by this dashboard.</p><div className="mt-5 space-y-2">{queue.map((item,i)=><div key={`${item.title}-${i}`} className="rounded-xl border border-white/[0.07] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-white">{item.title}</strong><span className="text-[11px] text-slate-400">{item.status||"Unspecified status"}</span></div>{item.detail&&<p className="mt-2 text-xs text-slate-500">{item.detail}</p>}</div>)}{queue.length===0&&<p className="py-6 text-sm text-slate-500">Queue source returned no items.</p>}</div></section>}
            {section === "Activity" && <section className="rounded-2xl border border-white/[0.08] bg-[#111a27] p-5"><h2 className="font-semibold text-white">System activity</h2><p className="mt-1 text-xs text-slate-500">Latest {recentEvents.length} recorded events from the timeline source.</p><div className="mt-5 space-y-3">{recentEvents.map((ev,i)=><div key={`${ev.atIso}-${ev.kind}-${i}`} className="grid grid-cols-[auto_1fr] gap-3 border-b border-white/[0.06] pb-3 last:border-0"><span className="mt-1 grid h-8 w-8 place-items-center rounded-lg bg-white/[0.05] text-violet-300"><GitCommitHorizontal size={16}/></span><div><div className="text-sm text-slate-200">{ev.label}</div><div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500"><span>{ev.kind.replace("_"," ")}</span><span>{timeLabel(ev.atIso)}</span>{ev.branch&&<span>{ev.branch}</span>}</div></div></div>)}{recentEvents.length===0&&<p className="py-6 text-sm text-slate-500">No activity is available.</p>}</div></section>}
            {selected && <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={()=>setSelected(null)}><aside role="dialog" aria-modal="true" aria-label={selected.name+" details"} className="h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-[#0d1520] p-6 shadow-2xl" onClick={e=>e.stopPropagation()}><div className="flex items-start justify-between"><div><div className="text-xs uppercase tracking-wider text-violet-300">Agent details</div><h2 className="mt-2 text-xl font-semibold text-white">{selected.name}</h2></div><button onClick={()=>setSelected(null)} aria-label="Close details" className="rounded-lg p-2 text-slate-400 hover:bg-white/10"><X size={18}/></button></div><div className="mt-5"><HealthPill health={selected.health}/></div><dl className="mt-6 space-y-4 text-sm"><div><dt className="text-xs text-slate-500">Current assignment</dt><dd className="mt-1 text-slate-200">{selected.lock?.notes||selected.reason||"No assignment recorded"}</dd></div><div><dt className="text-xs text-slate-500">Branch</dt><dd className="mt-1 break-all text-slate-200">{selected.branch||"None"}</dd></div><div><dt className="text-xs text-slate-500">Lock status</dt><dd className="mt-1 text-slate-200">{selected.lock?.status||"No active lock record"}</dd></div><div><dt className="text-xs text-slate-500">Last activity</dt><dd className="mt-1 text-slate-200">{timeLabel(selected.lastActivityAt)}</dd></div><div><dt className="text-xs text-slate-500">Recent commits</dt><dd className="mt-1 break-all text-slate-200">{selected.commits.length?selected.commits.join(", "):"No commit references"}</dd></div></dl><p className="mt-8 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 text-xs text-slate-500">This panel reports observed state only. Agent execution controls remain in the AI workspace.</p></aside></div>}
          </>}
          {data && <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-4 text-[11px] text-slate-600"><span>Data source: Adrian's Mind dashboard status API</span><span>{data.sources.commitsSource ? `Git: ${data.sources.commitsSource}` : "Git source not reported"} · Auto-refresh every 20 seconds</span></footer>}
        </div>
      </section>
    </div>
  </main>;
}
