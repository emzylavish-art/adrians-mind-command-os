import { parseProviderText } from "./provider-call.ts";

export type ImageAnalysis = { ok: boolean; analyzed: boolean; provider: "openai" | null; text: string; error: string };

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export async function analyzeImage(input: {
  name: string;
  bytes: number;
  imageBase64: string;
  visionKey: string | undefined;
  fetch: FetchLike;
  authorize?: () => Promise<(ok: boolean) => Promise<void>>;
}): Promise<ImageAnalysis> {
  if (!input.visionKey) {
    return { ok: false, analyzed: false, provider: null, text: "", error: "No vision key is configured. The chat key is not used for images. Nothing was analyzed." };
  }
  if (input.bytes < 32 || !input.imageBase64) {
    return { ok: false, analyzed: false, provider: null, text: "", error: "That image is empty. Nothing was analyzed." };
  }
  if (!/\.(png|jpe?g|gif|webp)$/i.test(input.name)) {
    return { ok: false, analyzed: false, provider: null, text: "", error: "That file is not a supported image. Nothing was analyzed." };
  }
  const bytes = Buffer.from(input.imageBase64, "base64");
  const mime = bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" ? "image/png"
    : bytes.subarray(0, 3).toString("hex") === "ffd8ff" ? "image/jpeg"
    : ["GIF89a", "GIF87a"].includes(bytes.subarray(0, 6).toString()) ? "image/gif"
    : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : null;
  if (!mime || bytes.length !== input.bytes || bytes.length > 400_000 || bytes.toString("base64") !== input.imageBase64) {
    return { ok: false, analyzed: false, provider: null, text: "", error: "The complete supported image is required. Nothing was analyzed." };
  }
  let response: Awaited<ReturnType<FetchLike>>;
  let settle: ((ok: boolean) => Promise<void>) | undefined;
  try { settle = await input.authorize?.(); }
  catch (error) { return { ok: false, analyzed: false, provider: null, text: "", error: error instanceof Error ? error.message : "Resource authorization failed. The image was not sent." }; }
  try {
    response = await input.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${input.visionKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: [{ type: "text", text: "Describe this image." }, { type: "image_url", image_url: { url: `data:${mime};base64,${input.imageBase64}` } }] }],
      }),
    });
  } catch {
    await settle?.(false);
    return { ok: false, analyzed: false, provider: "openai", text: "", error: "The vision provider could not be reached. Nothing was invented." };
  }
  await settle?.(response.ok);
  if (!response.ok) return { ok: false, analyzed: false, provider: "openai", text: "", error: `Vision returned ${response.status}. Nothing was invented.` };
  const text = parseProviderText("openai", await response.text()).slice(0, 2000);
  if (!text.trim()) return { ok: false, analyzed: false, provider: "openai", text: "", error: "Vision returned an empty reply. Nothing was invented." };
  return { ok: true, analyzed: true, provider: "openai", text, error: "" };
}
