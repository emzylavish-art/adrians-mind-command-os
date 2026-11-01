export type ProviderName = "grok" | "openai" | "anthropic" | "gemini" | "openrouter";

const KEYS: Record<Exclude<ProviderName, "grok">, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export function configuredProviders(env: Record<string, string | undefined>): Record<Exclude<ProviderName, "grok">, boolean> {
  return {
    openai: Boolean(env.OPENAI_API_KEY),
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    gemini: Boolean(env.GEMINI_API_KEY),
    openrouter: Boolean(env.OPENROUTER_API_KEY),
  };
}

export function selectProvider(id: unknown, env: Record<string, string | undefined>): { ok: true; id: ProviderName; model: string } | { ok: false; error: string } {
  const name = id == null || id === "" ? "grok" : id;
  if (name === "grok") return { ok: true, id: "grok", model: "grok-4.5" };
  if (name !== "openai" && name !== "anthropic" && name !== "gemini" && name !== "openrouter") {
    return { ok: false, error: "That provider is not known. Another provider is not substituted." };
  }
  if (!env[KEYS[name]]) return { ok: false, error: `No ${name} key is configured. Another provider is not substituted.` };
  const model = name === "openai" ? "gpt-4.1-mini" : name === "anthropic" ? "claude-sonnet-4-5" : name === "gemini" ? "gemini-2.0-flash" : "openrouter/auto";
  return { ok: true, id: name, model };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export async function callConfiguredProvider(input: {
  id: Exclude<ProviderName, "grok">;
  key: string;
  prompt: string;
  fetch: FetchLike;
}): Promise<{ ok: boolean; text: string; error: string }> {
  if (!input.key) return { ok: false, text: "", error: `No ${input.id} key is configured. Nothing was sent.` };
  const prompt = input.prompt.slice(0, 4000);
  const endpoints: Record<Exclude<ProviderName, "grok">, { url: string; init: RequestInit }> = {
    openai: { url: "https://api.openai.com/v1/chat/completions", init: { headers: { authorization: `Bearer ${input.key}`, "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-4.1-mini", messages: [{ role: "user", content: prompt }] }) } },
    anthropic: { url: "https://api.anthropic.com/v1/messages", init: { headers: { "x-api-key": input.key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 400, messages: [{ role: "user", content: prompt }] }) } },
    gemini: { url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(input.key)}`, init: { headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) } },
    openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", init: { headers: { authorization: `Bearer ${input.key}`, "content-type": "application/json" }, body: JSON.stringify({ model: "openrouter/auto", messages: [{ role: "user", content: prompt }] }) } },
  };
  const target = endpoints[input.id];
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await input.fetch(target.url, { method: "POST", ...target.init });
  } catch {
    return { ok: false, text: "", error: `${input.id} could not be reached. Nothing was substituted.` };
  }
  if (response.status === 429) return { ok: false, text: "", error: `${input.id} rate limited the request. Nothing was substituted.` };
  if (!response.ok) return { ok: false, text: "", error: `${input.id} returned ${response.status}. Nothing was substituted.` };
  const body = await response.text();
  return { ok: Boolean(body.trim()), text: body.slice(0, 4000), error: body.trim() ? "" : `${input.id} returned an empty reply.` };
}

/** Map provider selection failures to HTTP status. Unknown → 400; missing key/config → 503. */
export function httpStatusForProviderSelection(error: string): 400 | 503 {
  if (/not known/i.test(error)) return 400;
  if (/not configured|No .+ key is configured/i.test(error)) return 503;
  return 400;
}
