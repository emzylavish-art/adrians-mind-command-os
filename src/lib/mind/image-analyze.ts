import { parseProviderText } from "./provider-call.ts";

export type ImageAnalysis = { ok: boolean; analyzed: boolean; provider: "openai" | null; text: string; error: string };

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
export const IMAGE_ANALYSIS_MODEL = "gpt-4.1-mini";
export type ImageAnalysisInput = { name: string; bytes: number; imageBase64: string; visionKey: string | undefined };

export function validateImageAnalysis(input: ImageAnalysisInput): { ok: true; mime: string } | (ImageAnalysis & { ok: false }) {
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
  return { ok: true, mime };
}

export async function analyzeImage(input: ImageAnalysisInput & { fetch: FetchLike }): Promise<ImageAnalysis> {
  const prepared = validateImageAnalysis(input);
  if (!prepared.ok) return prepared;
  const { mime } = prepared;
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await input.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${input.visionKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: IMAGE_ANALYSIS_MODEL,
        messages: [{ role: "user", content: [{ type: "text", text: "Describe this image." }, { type: "image_url", image_url: { url: `data:${mime};base64,${input.imageBase64}` } }] }],
      }),
    });
  } catch {
    return { ok: false, analyzed: false, provider: "openai", text: "", error: "The vision provider could not be reached. Nothing was invented." };
  }
  if (!response.ok) return { ok: false, analyzed: false, provider: "openai", text: "", error: `Vision returned ${response.status}. Nothing was invented.` };
  const text = parseProviderText("openai", await response.text()).slice(0, 2000);
  if (!text.trim()) return { ok: false, analyzed: false, provider: "openai", text: "", error: "Vision returned an empty reply. Nothing was invented." };
  return { ok: true, analyzed: true, provider: "openai", text, error: "" };
}
