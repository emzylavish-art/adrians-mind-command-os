import type { VisionPolicy } from "./pc-vision.ts";
import type { PcExecution } from "./pc-action-plan.ts";
export type NativeRequestResult = { state: "receipt"; receipt: PcExecution } | { state: "not_sent" | "unknown"; error: string };
export async function runNativeDeviceRequest(input: { text: string; localEnabled: boolean; ownerId: string | null; halted: boolean; token?: string | null; visionPolicy?: VisionPolicy; signal?: AbortSignal }, fetcher: typeof fetch = fetch): Promise<NativeRequestResult> {
  if (!input.ownerId || !input.localEnabled || input.halted || input.signal?.aborted || !input.text.trim() || input.text.length > 24000) return { state: "not_sent", error: "Choose an available current local executor and valid request with emergency stop off. Nothing was sent." };
  if (/^understand (?:the )?screenshot$/i.test(input.text.trim()) && (!input.visionPolicy?.model || !input.visionPolicy.allowExternalImage)) return { state: "not_sent", error: "Select an exact vision model and authorize this primary-screen image before sending." };
  try {
    const response = await fetcher("/api/mind/pc/status", { method: "POST", credentials: "include", signal: input.signal, headers: { "content-type": "application/json", ...(input.token ? { authorization: `Bearer ${input.token}` } : {}) }, body: JSON.stringify({ text: input.text.trim(), destination: "current-device", ...(input.visionPolicy ? { visionPolicy: input.visionPolicy } : {}) }) });
    const body = await response.json();
    if (body && typeof body.recognized === "boolean" && typeof body.attempted === "boolean" && typeof body.completed === "boolean" && typeof body.verified === "boolean" && Array.isArray(body.receipts) && body.destination?.kind === "local" && typeof body.destination.deviceId === "string") return { state: "receipt", receipt: body };
    return { state: [401, 403].includes(response.status) || (response.status >= 400 && body?.ran === false) ? "not_sent" : "unknown", error: typeof body?.error === "string" ? body.error : "The local executor did not return a valid operation receipt. Inspect the device before another request." };
  } catch { return { state: "unknown", error: "Waiting stopped after the request was sent. The device's final effect is unknown. No automatic retry started; inspect it before preparing another request." }; }
}
