import { externalResourceCall } from "./external-resource-call.server.ts";
import { resolveXaiInferenceApiKey } from "./media/xai-key.ts";

/** Website-side authorization only; this does not alter the installed companion or its controls. */
export function ownerScreenshotReader(owner: string) {
  return async (png: Buffer): Promise<string> => {
    const apiKey = resolveXaiInferenceApiKey();
    if (!apiKey) return "No configured vision provider is available. The screenshot was not sent.";
    const model = process.env.GROK_VISION_MODEL?.trim() || "grok-4.7";
    const result = await externalResourceCall({ owner, provider: "xai-vision", unknownTokens: true, model }, async () => {
      const response = await fetch("https://api.x.ai/v1/responses", { method: "POST", signal: AbortSignal.timeout(25_000), headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model, max_output_tokens: 1024, input: [{ role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${png.toString("base64")}` }, { type: "input_text", text: "Describe only what is visible in this screenshot. Do not guess hidden content." }] }] }) });
      if (!response.ok) return { ok: false, error: `The selected vision model returned HTTP ${response.status}. No fallback model was called.` };
      const payload = await response.json() as { model?: string; output?: { content?: { text?: string }[] }[] };
      const text = (payload.output ?? []).flatMap((item) => item.content ?? []).map((item) => item.text ?? "").filter(Boolean).join(" ").slice(0, 2000);
      return text ? { ok: true, text: `Provider-reported model: ${payload.model || "unreported"}. ${text}` } : { ok: false, error: "The vision model returned no reading." };
    }).catch(() => ({ ok: false, error: "The vision request did not complete. Its outcome is unknown; no fallback was attempted." }));
    return result.ok && "text" in result ? result.text! : "error" in result ? result.error : "Vision returned no usable reading.";
  };
}
