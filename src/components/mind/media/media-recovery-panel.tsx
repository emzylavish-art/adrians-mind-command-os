import { useEffect, useRef, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { useAccountPreferences } from "@/components/mind/account-preferences-context";
import { readVideoRecovery, rememberVideoJob, pollRecoverableVideo, retryBlockedVideo, mergeVideoRecovery, type VideoClientContext } from "@/lib/mind/media/video-recovery";
import { videoRetentionLabel, type VideoJob } from "@/lib/mind/media/video-jobs";
import { loadVideoSettings, VIDEO_SETTINGS_KEY, VIDEO_CAPABILITIES, videoSettingOptions, validateVideoSettings, type VideoCapabilities, type VideoSettings } from "@/lib/mind/media/video-settings";
import { IMAGE_PREPARATION_KEY, loadImagePreparationQuality, type ImagePreparationQuality } from "@/lib/mind/media/image-metadata";
import { verifyDeviceVideoCopy, videoDeviceStore } from "@/lib/mind/media/video-device-store";

export function MediaRecoveryPanel({ ownerId, onComplete, onOpenChat, freeOnly = false, capabilities = VIDEO_CAPABILITIES }: { ownerId: string | null; onComplete?: (job: VideoJob) => void; onOpenChat?: (chatId: string) => void; freeOnly?: boolean; capabilities?: VideoCapabilities }) {
  const storage = useAccountPreferences();
  const owner = useRef(ownerId); owner.current = ownerId;
  const controller = useRef<AbortController | null>(null);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [settings, setSettings] = useState(() => loadVideoSettings(storage));
  const [quality, setQuality] = useState(() => loadImagePreparationQuality(storage));
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [temporaryRetryPrompts, setTemporaryRetryPrompts] = useState<Record<string, string>>({});
  const offered = videoSettingOptions(capabilities);
  const [copies, setCopies] = useState<Record<string, string>>({});
  const [copyTypes, setCopyTypes] = useState<Record<string, string>>({});
  const [expired, setExpired] = useState<Record<string, boolean>>({});
  const copyUrls = useRef<string[]>([]);
  const endpoint = () => `${typeof window === "undefined" ? "" : previewPathPrefix(window.location.hostname, window.location.pathname) || ""}/api/mind/media/generate`;
  const context = (): VideoClientContext => ({ ownerId: ownerId || "", currentOwner: () => owner.current, storage, endpoint: endpoint(), bearer: getBearerToken(), signal: controller.current?.signal });
  const update = (job: VideoJob) => { if (job.ownerId === owner.current) setJobs(current => [job, ...current.filter(item => item.operationId !== job.operationId)]); };

  useEffect(() => {
    const startedOwner = ownerId;
    const abort = new AbortController(); controller.current = abort;
    setJobs(startedOwner ? readVideoRecovery(storage, startedOwner) : []);
    setCopies({}); setCopyTypes({}); setExpired({}); setBusy(null); setTemporaryRetryPrompts({}); setSettings(loadVideoSettings(storage)); setQuality(loadImagePreparationQuality(storage));
    if (startedOwner) void (async () => {
      try {
        const token = getBearerToken();
        const response = await fetch(endpoint(), { method: "POST", credentials: "include", signal: abort.signal, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ kind: "video", action: "list" }) });
        const body = await response.json();
        if (abort.signal.aborted || owner.current !== startedOwner) return;
        if (!response.ok || !body.ok || !Array.isArray(body.jobs)) throw new Error(body.error || "Saved video operations could not be loaded.");
        const saved = mergeVideoRecovery(readVideoRecovery(storage, startedOwner), body.jobs as VideoJob[], startedOwner);
        setJobs(saved);
        const clientContext = { ...context(), ownerId: startedOwner };
        for (const job of saved) rememberVideoJob(clientContext, job);
        const store = videoDeviceStore(startedOwner);
        for (const job of saved.filter(item => item.state === "completed")) {
          const blob = await store.get(job.operationId).catch(() => undefined);
          if (abort.signal.aborted || owner.current !== startedOwner) return;
          if (blob) { const url = URL.createObjectURL(blob); copyUrls.current.push(url); setCopies(current => ({ ...current, [job.operationId]: url })); setCopyTypes(current => ({ ...current, [job.operationId]: blob.type })); }
        }
      } catch (error) { if (!abort.signal.aborted && owner.current === startedOwner) setNotice(error instanceof Error ? error.message : "Video recovery is unavailable."); }
    })();
    return () => { abort.abort(); copyUrls.current.forEach(url => URL.revokeObjectURL(url)); copyUrls.current = []; };
  }, [ownerId, storage]);

  function saveSettings(next: VideoSettings) {
    setSettings(next);
    const parsed = validateVideoSettings(next, capabilities);
    if (!parsed.ok) { setNotice(`${parsed.error} These changes have not been saved.`); return; }
    try { storage.setItem(VIDEO_SETTINGS_KEY, JSON.stringify(next)); setSettings(next); setNotice("Settings saved for future video requests. Longer clips and higher resolutions can increase provider cost; nothing was generated."); }
    catch { setNotice("Video settings could not be saved. Existing preferences were preserved."); }
  }
  async function resume(job: VideoJob) {
    if (!ownerId || busy || job.ownerId !== ownerId) return;
    const startedOwner = ownerId; setBusy(job.operationId); setNotice("Checking the existing provider job. No generation request will be repeated.");
    try {
      const result = await pollRecoverableVideo(job, context(), { onUpdate: update });
      if (owner.current !== startedOwner || controller.current?.signal.aborted) return;
      setNotice(result.ok && result.state === "done" ? "Existing generation recovered. Save an explicit copy if you need permanent access." : result.ok ? "The saved generation is still rendering." : result.error);
      if (result.ok && result.state === "done") onComplete?.(result.job);
    } catch { if (owner.current === startedOwner) setNotice("Recovery was interrupted. The saved job remains available; no new generation was submitted."); }
    finally { if (owner.current === startedOwner) setBusy(null); }
  }
  async function retryUnsent(job: VideoJob) {
    if (!ownerId || busy || job.ownerId !== ownerId || freeOnly) return;
    const startedOwner = ownerId; setBusy(job.operationId); setNotice("Retrying this unchanged, previously unsent request after your review. Account limits are checked again.");
    try {
      const result = await retryBlockedVideo(job, context(), { freeOnly, temporaryPrompt: temporaryRetryPrompts[job.operationId] });
      if (owner.current !== startedOwner || controller.current?.signal.aborted) return;
      if (result.job) update(result.job);
      setNotice(result.ok ? "The reviewed request was accepted. Use Resume status checks for this same provider job." : result.error);
      if (result.ok) setTemporaryRetryPrompts(current => { const next = { ...current }; delete next[job.operationId]; return next; });
    } catch { if (owner.current === startedOwner) setNotice("The explicit retry was interrupted. Check the same saved operation before trying again."); }
    finally { if (owner.current === startedOwner) setBusy(null); }
  }

  async function saveCopy(job: VideoJob) {
    if (!ownerId || job.ownerId !== ownerId || job.temporary || busy) return;
    const startedOwner = ownerId; setBusy(job.operationId);
    try {
      const token = getBearerToken();
      const response = await fetch(endpoint(), { method: "POST", credentials: "include", signal: controller.current?.signal, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ kind: "video", action: "download", operationId: job.operationId }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || "The provider link could not be downloaded."); }
      const blob = await response.blob();
      if (owner.current !== startedOwner || controller.current?.signal.aborted) return;
      const saved = await verifyDeviceVideoCopy(videoDeviceStore(startedOwner), job.operationId, blob);
      if (owner.current !== startedOwner || controller.current?.signal.aborted) return;
      const url = URL.createObjectURL(saved); copyUrls.current.push(url); setCopies(current => ({ ...current, [job.operationId]: url }));
      setCopyTypes(current => ({ ...current, [job.operationId]: saved.type }));
      setNotice("Video copy saved and read back from this account's device storage. Download it for an independent backup.");
    } catch (error) { if (owner.current === startedOwner) setNotice(error instanceof Error ? error.message : "No permanent copy was verified."); }
    finally { if (owner.current === startedOwner) setBusy(null); }
  }

  return <section className="settings-card space-y-4 rounded-panel border border-line p-4" aria-label="Media settings and recovery">
    <div><h3 className="font-semibold">Media settings and recovery</h3><p className="mt-1 text-xs text-muted">Current video adapter: {capabilities.model}. Settings describe supported request formats; they do not verify live account access.</p></div>
    <div className="grid gap-3 md:grid-cols-3">
      <label className="grid gap-1 text-sm">Duration<select className="min-h-11 rounded-panel border border-line bg-bg px-3" value={settings.duration} onChange={event => saveSettings({ ...settings, duration: Number(event.target.value) })}>{!offered.durations.includes(settings.duration) && <option value={settings.duration} disabled>{settings.duration} seconds — unavailable</option>}{offered.durations.map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label>
      <label className="grid gap-1 text-sm">Aspect ratio<select className="min-h-11 rounded-panel border border-line bg-bg px-3" value={settings.aspectRatio} onChange={event => saveSettings({ ...settings, aspectRatio: event.target.value as VideoSettings["aspectRatio"] })}>{!offered.aspectRatios.includes(settings.aspectRatio) && <option value={settings.aspectRatio} disabled>{settings.aspectRatio} — unavailable</option>}{offered.aspectRatios.map(ratio => <option key={ratio}>{ratio}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Resolution<select className="min-h-11 rounded-panel border border-line bg-bg px-3" value={settings.resolution} onChange={event => saveSettings({ ...settings, resolution: event.target.value as VideoSettings["resolution"] })}>{!offered.resolutions.includes(settings.resolution) && <option value={settings.resolution} disabled>{settings.resolution} — unavailable</option>}{offered.resolutions.map(resolution => <option key={resolution}>{resolution}</option>)}</select></label>
    </div>
    <p className="text-xs text-muted">Duration and resolution affect cost. 1080p on this adapter upscales 720p. Defaults remain 5 seconds at 480p; changing settings does not start a generation.</p>
    <label className="grid gap-1 text-sm">Image preparation<select className="min-h-11 rounded-panel border border-line bg-bg px-3" value={quality} onChange={event => { const next = event.target.value as ImagePreparationQuality; try { storage.setItem(IMAGE_PREPARATION_KEY, next); setQuality(next); setNotice("Quality saved for new attachments. Existing attachments retain their preparation receipts."); } catch { setNotice("Image quality preference could not be saved."); } }}><option value="data-saver">Data saver — smaller images</option><option value="balanced">Balanced</option><option value="high-detail">High detail — higher quality within adapter limits</option></select></label>
    {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
    <details><summary className="cursor-pointer text-sm font-semibold">Saved video operations ({jobs.length})</summary><div className="mt-3 space-y-3">{jobs.map(job => <article key={job.operationId} className="rounded-panel border border-line p-3 text-sm">
      <p className="font-semibold">{job.prompt || "Temporary video generation"}</p><p className="mt-1 text-xs text-muted">{job.state} · {job.settings.duration}s · {job.settings.aspectRatio} · {job.settings.resolution} · {job.operationId}</p>
      <p className="mt-1 text-xs text-muted">{videoRetentionLabel(job, Boolean(copies[job.operationId]))}</p>
      {job.error && <p className="mt-1 text-xs text-warning">{job.error}</p>}
      {(copies[job.operationId] || job.url) && <video className="mt-2 max-h-64 w-full rounded-panel" src={copies[job.operationId] || job.url} controls playsInline preload="none" onError={() => setExpired(current => ({ ...current, [job.operationId]: true }))} />}
      {expired[job.operationId] && !copies[job.operationId] && <p role="status" className="mt-1 text-xs text-warning">The provider link cannot be played and may have expired. No permanent device copy was found.</p>}
      {job.state === "blocked" && job.temporary && <label className="mt-2 grid gap-1 text-xs">Original temporary prompt<textarea maxLength={2000} value={temporaryRetryPrompts[job.operationId] || ""} onChange={event => setTemporaryRetryPrompts(current => ({ ...current, [job.operationId]: event.target.value }))} className="min-h-20 rounded-panel border border-line bg-bg p-2" placeholder="Re-enter the original text; it was not saved." /></label>}
      <div className="mt-2 flex flex-wrap gap-2">
        {job.state === "blocked" && job.requestHash && <button type="button" disabled={Boolean(busy) || freeOnly} className="min-h-11 rounded-panel border border-line px-3" onClick={() => void retryUnsent(job)}>{busy === job.operationId ? "Checking reviewed request…" : "Retry unchanged request after review"}</button>}
        {job.state !== "completed" && job.state !== "failed" && job.state !== "blocked" && <button type="button" disabled={Boolean(busy)} className="min-h-11 rounded-panel border border-line px-3" onClick={() => void resume(job)}>{busy === job.operationId ? "Checking existing job…" : "Resume status checks"}</button>}
        {job.state === "completed" && !job.temporary && !copies[job.operationId] && <button type="button" disabled={Boolean(busy)} className="min-h-11 rounded-panel border border-line px-3" onClick={() => void saveCopy(job)}>Save on this device</button>}
        {copies[job.operationId] && <a className="inline-flex min-h-11 items-center rounded-panel border border-line px-3" href={copies[job.operationId]} download={`adrian-video-${job.operationId}.${copyTypes[job.operationId] === "video/webm" ? "webm" : "mp4"}`}>Download saved copy</a>}
        {job.chatId && onOpenChat && <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => onOpenChat(job.chatId)}>Open original chat</button>}
      </div>
    </article>)}{jobs.length === 0 && <p className="text-sm text-muted">No video recovery records for this account.</p>}</div></details>
  </section>;
}
