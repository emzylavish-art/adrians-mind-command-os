import { useMemo, useRef, useState } from "react";
import type { Workspace } from "@/lib/mind/types";
import type { AppUser } from "@/lib/auth/use-current-user";
import { profileActivity, profileInsights, type ChartInterval } from "@/lib/mind/profile-activity";
import { useAccountPreferences } from "./account-preferences-context";
import { UsageHistory } from "./usage-history";

type Profile = { avatar?: string; name: string; handle: string; projects: string[] };
export function WorkspaceProfile({ account, workspace, onBuild }: { account: AppUser; workspace: Workspace; onBuild: () => void }) {
  const storage = useAccountPreferences();
  const [profile, setProfile] = useState<Profile>(() => {
    const fallback = { name: account.isDevFallback ? "Local workspace" : account.displayName || "My workspace", handle: "", projects: [] };
    try {
      const item = JSON.parse(storage.getItem("workspace-profile") || "null");
      if (!item || typeof item.name !== "string") return fallback;
      return { avatar: typeof item.avatar === "string" && /^data:image\/(png|jpeg);base64,/.test(item.avatar) ? item.avatar : undefined, name: item.name, handle: typeof item.handle === "string" ? item.handle : "", projects: Array.isArray(item.projects) ? item.projects.filter((id: unknown) => typeof id === "string") : [] };
    } catch { return fallback; }
  });
  const [draft, setDraft] = useState<Profile | null>(null);
  const photoRequest = useRef(0);
  const [readingPhoto, setReadingPhoto] = useState(false);
  async function selectPhoto(file?: File) {
    if (!file) return;
    const request = ++photoRequest.current;
    setReadingPhoto(true);
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Choose a JPEG, PNG or WebP up to 10 MB.");
      const { fileToDownscaledDataUrl } = await import("./media/downscale");
      const image = await fileToDownscaledDataUrl(file, 160);
      if (photoRequest.current === request) {
        setDraft(current => current && { ...current, avatar: image.dataUrl });
        setStatus("Photo ready to save.");
      }
    } catch (error) {
      if (photoRequest.current === request) setStatus(error instanceof Error ? error.message : "The photo could not be read.");
    } finally {
      if (photoRequest.current === request) setReadingPhoto(false);
    }
  }
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(false);
  const [interval, setInterval] = useState<ChartInterval>("Daily");
  const stats = useMemo(() => profileActivity(workspace, interval), [workspace.usage, workspace.runs, interval]);
  const insights = useMemo(() => profileInsights(workspace), [workspace.chats, workspace.runs]);
  const max = Math.max(...stats.buckets.map(bucket => bucket.known), 1);
  const projects = workspace.projects.filter(project => !project.archived && project.lifecycle !== "archived");
  const featured = projects.filter(project => profile.projects.includes(project.id));
  const shareText = [profile.name, profile.handle && "@" + profile.handle, ...featured.map(project => project.name)].filter(Boolean).join("\n");
  const avatar = profile.avatar || account.profileImageUrl;
  const control = "min-h-11 rounded-panel border border-line px-3 text-sm";
  const summary = [
    ["Known tokens", stats.knownTokens.toLocaleString()], ["Peak UTC day", stats.peak.toLocaleString()],
    ["Longest completed task", stats.longestRunMs === null ? "No completed runs" : Math.ceil(stats.longestRunMs / 60000) + " min"],
    ["Longest streak", stats.longestStreak + " days"], ["Current streak", stats.currentStreak + " days"],
  ];
  return <section className="space-y-4">
    <header className="flex flex-wrap items-center gap-3">
      {avatar ? <img className="size-12 rounded-full object-cover" src={avatar} alt="" /> : <span className="grid size-12 place-items-center rounded-full bg-surface-2 text-xl">{profile.name.slice(0, 1)}</span>}
      <div className="mr-auto"><h2 className="text-xl font-semibold">{profile.name}</h2><p className="text-sm text-muted">{profile.handle && `@${profile.handle} · `}Private workspace profile</p></div>
      <button className={control} type="button" onClick={() => { setDraft({ ...profile }); setStatus(""); }}>Edit profile</button>
      <button className={control} type="button" aria-expanded={preview} onClick={() => setPreview(!preview)}>Preview sharing</button>
    </header>
    {draft && <form className="grid gap-3 rounded-panel border border-line p-4" onSubmit={event => {
      event.preventDefault(); const saved = { ...draft, name: draft.name.trim(), handle: draft.handle.trim() };
      if (!saved.name) { setStatus("Enter a display name."); return; }
      try { storage.setItem("workspace-profile", JSON.stringify(saved)); setProfile(saved); setDraft(null); setStatus("Profile saved for this account on this device."); }
      catch { setStatus("Your profile could not be saved. Your edits are still here."); }
    }}>
      <label className="grid gap-1">Profile photo on this device
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { void selectPhoto(event.target.files?.[0]); event.target.value = ""; }} />
      </label>
      {draft.avatar && <div className="flex items-center gap-2">
        <img className="size-12 rounded-full object-cover" src={draft.avatar} alt="Selected profile photo" />
        <button type="button" className={control} onClick={() => { photoRequest.current++; setReadingPhoto(false); setDraft({ ...draft, avatar: undefined }); }}>Use account photo or initials</button>
      </div>}
      <label>Display name <input className={control} required maxLength={70} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>Handle <input className={control} maxLength={40} pattern="[A-Za-z0-9_]+" value={draft.handle} onChange={event => setDraft({ ...draft, handle: event.target.value })} /></label>
      <fieldset><legend>Projects to showcase</legend>{projects.map(project => <label key={project.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={draft.projects.includes(project.id)} onChange={event => setDraft({ ...draft, projects: event.target.checked ? [...draft.projects, project.id] : draft.projects.filter(id => id !== project.id) })} />{project.name}</label>)}</fieldset>
      <div className="flex gap-2"><button className={control} type="submit" disabled={readingPhoto}>Save profile</button><button className={control} type="button" onClick={() => { photoRequest.current++; setReadingPhoto(false); setDraft(null); }}>Cancel</button></div>
    </form>}
    {preview && <section className="rounded-panel border border-line p-4"><h3 className="font-semibold">Share preview</h3><pre className="my-2 whitespace-pre-wrap">{shareText}</pre><button className={control} type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(shareText); setStatus("Profile summary copied."); }
      catch { setStatus("Select and copy the text in the preview."); }
    }}>Copy profile summary</button></section>}
    <p role="status" className="text-sm">{status}</p>
    <h3 className="font-semibold">Workspace activity</h3>
    <dl className="grid grid-cols-2 gap-2 md:grid-cols-5">{summary.map(([label, value]) => <div className="rounded-panel border border-line p-3" key={label}><dt className="text-xs text-muted">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl>
    <section className="rounded-panel border border-line p-4"><h3 className="font-semibold">Token activity</h3><p className="mb-2 text-xs text-muted">Last 84 UTC days from retained workspace receipts. {stats.missing} receipts have incomplete token counts.</p>
      <div role="group" aria-label="Chart interval" className="flex flex-wrap gap-1">{(["Daily", "Weekly", "Cumulative"] as const).map(value => <button className={control + " aria-pressed:bg-fg aria-pressed:text-bg"} type="button" key={value} aria-pressed={interval === value} onClick={() => setInterval(value)}>{value}</button>)}</div>
      <div className="mt-3 flex h-20 items-end gap-px" aria-hidden="true">{stats.buckets.map(bucket => <span key={bucket.date} className="min-w-0 flex-1 rounded-t-sm" style={{ height: Math.max(2, 100 * bucket.known / max) + "%", backgroundColor: bucket.known ? "var(--accent, currentColor)" : "currentColor", opacity: bucket.known ? 1 : .16 }} />)}</div>
      <details className="mt-2 text-xs"><summary className="cursor-pointer py-2">Read chart values</summary><div className="max-h-52 overflow-auto"><table><thead><tr><th>Period (UTC)</th><th>Known tokens</th><th>Receipts</th><th>Incomplete receipts</th></tr></thead><tbody>{stats.buckets.map(bucket => <tr key={bucket.date}><td>{bucket.date}{interval === "Weekly" && " – " + bucket.end}</td><td>{bucket.known}</td><td>{bucket.receipts}</td><td>{bucket.partial}</td></tr>)}</tbody></table></div></details>
    </section>
    <section className="rounded-panel border border-line p-4">
      <h3 className="font-semibold">Top plugins</h3>
      <p className="text-xs text-muted">Successful Gmail, browser and web search operations in retained agent runs.</p>
      {insights.plugins.length ? <ol className="list-inside list-decimal">{insights.plugins.map(plugin =>
        <li key={plugin.name}>{plugin.name} · {plugin.count} {plugin.count === 1 ? "operation" : "operations"}</li>
      )}</ol> : <p>No matching operation receipts.</p>}
    </section>
    <section className="rounded-panel border border-line p-4">
      <h3 className="font-semibold">Insights</h3>
      <p className="text-xs text-muted">All retained non-temporary Chat replies in this workspace, excluding inherited copies.</p>
      <dl>
        <dt>Fast mode</dt><dd>{insights.tierReceipts ? Math.round(100 * insights.fast / insights.tierReceipts) + "% · " + insights.fast + " of " + insights.tierReceipts + " replies with a recorded tier" : "No resolved tiers recorded."}</dd>
        <dt>Most requested reasoning effort</dt><dd>{insights.effortReports ? insights.topEfforts.join(" / ") + " · " + Math.round(100 * insights.peakEffort / insights.effortReports) + "% per level among " + insights.effortReports + " completed replies with an explicit request setting" : "No completed replies with a recorded reasoning effort."}</dd>
        <dt>Skills applied</dt><dd>{insights.skillReports ? insights.distinctSkills + " distinct skills · " + insights.appliedSkills + " instruction applications across " + insights.skillReports + " replies with skill reports" : "No skill reports recorded."}</dd>
      </dl>
    </section>
    <section className="rounded-panel border border-line p-4"><h3 className="font-semibold">Showcase</h3>{featured.length ? <ul>{featured.map(project => <li key={project.id}>{project.name}</li>)}</ul> : <p className="text-sm text-muted">Choose a project in Edit profile to feature it here.</p>}<button className={control + " mt-2"} type="button" onClick={onBuild}>Create a site in Build</button></section>
    {!account.isDevFallback && <UsageHistory ownerId={account.id} />}
  </section>;
}
