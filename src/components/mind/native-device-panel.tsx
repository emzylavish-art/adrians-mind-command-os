import { useEffect, useRef, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import { runNativeDeviceRequest, type NativeRequestResult } from "@/lib/mind/native-device-client";
import type { PcCapability } from "@/lib/mind/pc-capability";
type DeviceStatus = { localExecution?: { enabled: boolean; deviceId: string; platform: string; arch: string; networkPolicy: string | null }; agents?: Array<{ id: string; label: string }>; onlineAgentIds?: string[]; capabilities?: PcCapability[]; error?: string };
export function NativeDevicePanel({ ownerId, halted }: { ownerId: string | null; halted: boolean }) {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [statusText, setStatusText] = useState("Refresh to inspect local and paired device availability.");
  const [text, setText] = useState("list windows");
  const [model, setModel] = useState("");
  const [allowImage, setAllowImage] = useState(false);
  const [allowFallback, setAllowFallback] = useState(false);
  const [fallbackModel, setFallbackModel] = useState("");
  const [result, setResult] = useState<NativeRequestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const statusRequest = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; statusRequest.current?.abort(); actionRequest.current?.abort(); }; }, []);
  async function refresh() {
    statusRequest.current?.abort(); const controller = new AbortController(); statusRequest.current = controller;
    const timer = setTimeout(() => controller.abort(), 10_000);
    setStatusText("Reading device state…");
    try {
      const token = getBearerToken();
      const response = await fetch("/api/mind/pc/status", { credentials: "include", cache: "no-store", signal: controller.signal, headers: token ? { authorization: `Bearer ${token}` } : {} });
      const body = await response.json() as DeviceStatus;
      if (!response.ok) throw new Error(body.error || "Device state is unavailable.");
      if (!controller.signal.aborted && mounted.current) { setStatus(body); setStatusText(body.localExecution?.enabled ? "Current installed device is available for explicit requests. Individual actions still require a receipt." : "This runtime cannot execute local PC actions. Paired availability is listed separately."); }
    } catch (error) { if (statusRequest.current === controller && mounted.current) { setStatus(null); setStatusText(error instanceof Error ? error.message : "Device state is unavailable."); } }
    finally { clearTimeout(timer); if (statusRequest.current === controller) statusRequest.current = null; }
  }
  const vision = /^understand (?:the )?screenshot$/i.test(text.trim());
  async function run() {
    if (actionRequest.current || uncertain) return;
    const controller = new AbortController(); actionRequest.current = controller; setBusy(true); setResult(null);
    const timer = setTimeout(() => controller.abort(), 65_000);
    const response = await runNativeDeviceRequest({ ownerId, halted, localEnabled: status?.localExecution?.enabled === true, text, token: getBearerToken(), signal: controller.signal, ...(vision ? { visionPolicy: { model: model.trim(), allowExternalImage: allowImage, allowFallback, fallbackModel: fallbackModel.trim(), captureScope: "primary-screen" as const, timeoutMs: 20_000 } } : {}) });
    clearTimeout(timer); actionRequest.current = null;
    if (!mounted.current) return;
    setBusy(false); setAllowImage(false); setResult(response);
    setUncertain(response.state === "unknown" || (response.state === "receipt" && response.receipt.state === "unconfirmed"));
  }
  return <section className="mb-5 rounded-panel border border-line bg-panel p-4" aria-labelledby="native-device-heading">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="native-device-heading" className="text-base font-semibold">Device execution</h2><button className="min-h-11 rounded-panel border border-line px-3 text-sm" type="button" onClick={() => void refresh()} disabled={!ownerId}>Refresh device state</button></div>
    <p role="status" className="mt-2 text-sm text-muted">{statusText}</p>
    {status && <dl className="mt-3 grid gap-1 text-sm"><div><dt className="inline font-medium">Current executor: </dt><dd className="inline">{status.localExecution?.enabled ? `${status.localExecution.deviceId} · ${status.localExecution.platform}/${status.localExecution.arch}` : "Unavailable"}</dd></div><div><dt className="inline font-medium">Paired devices online: </dt><dd className="inline">{status.onlineAgentIds?.length || 0}. Online status does not route this request to another PC.</dd></div><div><dt className="inline font-medium">Network policy: </dt><dd className="inline">{status.localExecution?.networkPolicy || "Hosted service"}</dd></div></dl>}
    {status?.localExecution?.enabled && <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void run(); }}>
      <label className="block text-sm">Exact request for the current installed device<textarea className="mt-1 min-h-24 w-full rounded-panel border border-line bg-transparent p-3" value={text} onChange={event => setText(event.target.value)} maxLength={24000} disabled={busy} /></label>
      <p className="text-xs text-muted">Discovery example: find button Save. A separate interaction names its window: click button &quot;Save&quot; in window &quot;Document&quot;. Multiple supported actions use “then”; failed prerequisites stop dependent steps.</p>
      <button className="min-h-11 rounded-panel border border-line px-3 text-sm" type="button" disabled={busy} onClick={() => setText("understand the screenshot")}>Prepare screenshot analysis</button>
      {vision && <fieldset className="space-y-2 rounded-panel border border-line p-3" disabled={busy}><legend className="px-1 text-sm font-medium">This screenshot request</legend><p className="text-xs text-muted">Only the primary screen is captured. xAI vision requires a connected inference key. Select the exact model; its receipt must confirm the model used. Provider charges may apply to each authorized attempt. Local-only mode blocks external analysis.</p><label className="block text-sm">xAI vision model<input className="mt-1 min-h-11 w-full rounded-panel border border-line bg-transparent px-3" value={model} onChange={event => setModel(event.target.value)} placeholder="Exact connected model ID" /></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={allowImage} onChange={event => setAllowImage(event.target.checked)} />Allow this primary-screen image to be sent to the selected provider</label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={allowFallback} onChange={event => setAllowFallback(event.target.checked)} />Allow one explicitly selected fallback only if the first model rejects image capability</label>{allowFallback && <label className="block text-sm">Allowed fallback model<input className="mt-1 min-h-11 w-full rounded-panel border border-line bg-transparent px-3" value={fallbackModel} onChange={event => setFallbackModel(event.target.value)} /></label>}</fieldset>}
      <div className="flex flex-wrap gap-2"><button className="min-h-11 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink" type="submit" disabled={busy || halted || uncertain || !text.trim() || (vision && (!allowImage || !model.trim() || status.localExecution.networkPolicy === "local-only" || (allowFallback && !fallbackModel.trim())))}>{busy ? "Waiting for device receipt…" : "Run on current device"}</button>{busy && <button className="min-h-11 rounded-panel border border-line px-3 text-sm" type="button" onClick={() => actionRequest.current?.abort()}>Stop waiting / cancel</button>}</div>
    </form>}
    {result && <div className="mt-3 whitespace-pre-wrap text-sm" role={result.state === "receipt" && result.receipt.completed ? "status" : "alert"}>{result.state === "receipt" ? <><p>{result.receipt.output}</p><p className="mt-2 text-xs text-muted">Recognized: {String(result.receipt.recognized)} · authorized: {String(result.receipt.authorized)} · attempted: {String(result.receipt.attempted)} · completed: {String(result.receipt.completed)} · independently verified: {String(result.receipt.verified)}. Destination: {result.receipt.destination.deviceId}</p>{result.receipt.receipts.map(receipt => <p className="mt-1 text-xs text-muted" key={receipt.actionId}>{receipt.actionId}: {receipt.kind} · {receipt.state}</p>)}</> : result.error}</div>}
    {uncertain && <button className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" type="button" onClick={() => { setUncertain(false); setText(""); }}>I inspected the device; prepare a new request</button>}
    {status?.capabilities && <details className="mt-3 text-xs text-muted"><summary>Feature availability and proof</summary><ul className="mt-2 space-y-1">{status.capabilities.map(capability => <li key={capability.id}>{capability.id}: {capability.state}; {capability.offline}; current-device proof {capability.verification}. {capability.requirement}</li>)}</ul></details>}
  </section>;
}
