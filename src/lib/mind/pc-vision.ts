export type VisionPolicy = { model: string; allowExternalImage: boolean; allowFallback: boolean; fallbackModel?: string; captureScope: "primary-screen"; timeoutMs?: number };
export type VisionReceipt = { state: "completed" | "blocked" | "failed" | "unconfirmed" | "canceled"; output: string; attempted: boolean; provider: "xai"; requestedModel: string | null; actualModel: string | null; attempts: number };

export function boundedOperation<T>(start: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Canceled")); return; }
    const abort = () => { cleanup(); reject(new Error("Canceled or timed out")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(start).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export async function analyzePcScreenshot(png: Buffer, apiKey: string, policy: VisionPolicy, options: { fetch?: typeof fetch; signal?: AbortSignal; authorize?: (model: string) => boolean | Promise<boolean> } = {}): Promise<VisionReceipt> {
  const result = (state: VisionReceipt["state"], output: string, attempted = false, actualModel: string | null = null, attempts = 0): VisionReceipt => ({ state, output, attempted, provider: "xai", requestedModel: policy.model || null, actualModel, attempts });
  if (policy.allowExternalImage !== true || typeof policy.model !== "string" || policy.captureScope !== "primary-screen" || !/^[A-Za-z0-9._:/-]{1,100}$/.test(policy.model) || !apiKey) return result("blocked", "Choose an exact vision model and authorize external processing of the primary-screen capture. No vision model was called.");
  if (!Buffer.isBuffer(png) || png.length < 32 || png.length > 12_000_000) return result("blocked", "The screenshot is missing or exceeds the supported image size. No vision model was called.");
  const deadlineMs = typeof policy.timeoutMs === "number" && Number.isFinite(policy.timeoutMs) ? Math.min(60_000, Math.max(1, policy.timeoutMs)) : 20_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const models = [policy.model];
  if (policy.allowFallback === true && typeof policy.fallbackModel === "string" && policy.fallbackModel && policy.fallbackModel !== policy.model && /^[A-Za-z0-9._:/-]{1,100}$/.test(policy.fallbackModel)) models.push(policy.fallbackModel);
  let attempts = 0;
  try {
    for (const model of models) {
      if (signal.aborted) return result(attempts ? "unconfirmed" : "canceled", attempts ? "Vision processing was canceled after dispatch. Its external outcome is unknown; no retry started." : "Vision was canceled before dispatch.", attempts > 0, null, attempts);
      if (options.authorize && !await boundedOperation(() => Promise.resolve(options.authorize!(model)), signal)) return result("blocked", "Current policy does not authorize this vision model. No additional request was sent.", attempts > 0, null, attempts);
      attempts++;
      const response = await boundedOperation(() => (options.fetch ?? fetch)("https://api.x.ai/v1/responses", {
        method: "POST", redirect: "error", signal, headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, input: [{ role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${png.toString("base64")}` }, { type: "input_text", text: "Describe only what is visible in this screenshot. Do not guess hidden content." }] }] }),
      }), signal);
      const raw = await boundedOperation(() => response.text(), signal);
      if (!response.ok) {
        if (attempts < models.length && [400, 422].includes(response.status) && /image|vision|unsupported/i.test(raw)) continue;
        return result("failed", `${model} returned HTTP ${response.status}. ${policy.allowFallback ? "No further authorized attempt is available." : "Fallback is prohibited; no second model was called."}`, true, null, attempts);
      }
      let data: { model?: unknown; output?: Array<{ content?: Array<{ text?: unknown }> }>; choices?: Array<{ message?: { content?: unknown } }> };
      try { data = JSON.parse(raw); } catch { return result("unconfirmed", "The vision provider returned an invalid receipt. No verified answer was recorded.", true, null, attempts); }
      const actualModel = typeof data.model === "string" ? data.model : null;
      if (actualModel !== model) return result("unconfirmed", `The vision receipt did not confirm the selected model ${model}. Reported model: ${actualModel ?? "missing"}.`, true, actualModel, attempts);
      const text = (data.output ?? []).flatMap(item => item.content ?? []).map(part => typeof part.text === "string" ? part.text : "").filter(Boolean).join(" ") || (typeof data.choices?.[0]?.message?.content === "string" ? data.choices[0].message.content : "");
      return text.trim() ? result("completed", `Vision reading from ${actualModel}: ${text.slice(0, 4000)}`, true, actualModel, attempts) : result("failed", `${actualModel} returned no reading. Nothing was invented.`, true, actualModel, attempts);
    }
    return result("failed", "No authorized vision route completed.", attempts > 0, null, attempts);
  } catch {
    return result(attempts ? "unconfirmed" : signal.aborted ? "canceled" : "blocked", attempts ? "Vision waiting stopped after dispatch. The external processing outcome is unknown; no automatic retry started." : "Vision authorization could not be confirmed. No provider was called.", attempts > 0, null, attempts);
  } finally { clearTimeout(timer); controller.abort(); }
}
