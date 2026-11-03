/**
 * Qwen orchestrator endpoint config for Voice Cloning Studio.
 * Reuses the existing Ollama/Orchestrator loopback policy (ollama-host) —
 * does not duplicate the conductor. Zack runs Qwen (~18 GB) on his PC later.
 */
import { resolveSafeOllamaBase, ollamaAllowRemoteFromEnv } from "../voice/ollama-host.ts";
import { resolveVoiceCloneLocalUrlFromEnv } from "./local-url.ts";

export const DEFAULT_QWEN_URL = "http://127.0.0.1:11434";

export type QwenOrchestratorConfig = {
  /** OpenAI-compatible or Ollama base (chat). */
  qwenBase: string;
  /** Local voice-clone engine the orchestrator should call for studio TTS. */
  voiceCloneBase: string;
  configured: boolean;
  message: string;
};

/**
 * Resolve Qwen/Ollama URL from env without contacting the model.
 * Preferred env: VOICE_QWEN_URL, then OLLAMA_HOST / MIND_OLLAMA_URL.
 */
export function resolveQwenOrchestratorConfig(
  env: Record<string, string | undefined> = process.env,
): QwenOrchestratorConfig {
  const raw =
    env.VOICE_QWEN_URL?.trim() ||
    env.MIND_OLLAMA_URL?.trim() ||
    env.OLLAMA_HOST?.trim() ||
    DEFAULT_QWEN_URL;
  const qwen = resolveSafeOllamaBase(raw, {
    allowRemote: ollamaAllowRemoteFromEnv(env),
    fallback: DEFAULT_QWEN_URL,
  });
  const clone = resolveVoiceCloneLocalUrlFromEnv(env);

  if (!qwen.ok) {
    return {
      qwenBase: "",
      voiceCloneBase: clone.ok ? clone.base : "",
      configured: false,
      message: qwen.error,
    };
  }
  if (!clone.ok) {
    return {
      qwenBase: qwen.base,
      voiceCloneBase: "",
      configured: false,
      message: clone.error,
    };
  }
  return {
    qwenBase: qwen.base,
    voiceCloneBase: clone.base,
    configured: true,
    message:
      `Qwen/Orchestrator base ${qwen.base}; studio TTS via local engine ${clone.base}. ` +
      `Start Ollama/Qwen and tools/voice-clone-server on your PC before live orchestrator cloning. ` +
      `MCP server option is documented as future work only.`,
  };
}

/**
 * Helper for Orchestrator mode: ask the local clone engine to speak.
 * Uses the same /tts contract as the Studio UI. No model weights are loaded here.
 */
export async function orchestratorRequestLocalTts(input: {
  text: string;
  voiceId: string;
  format?: "mp3" | "wav";
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; error: string }> {
  const { resolveVoiceCloneProvider } = await import("./provider.ts");
  const provider = resolveVoiceCloneProvider({ env: input.env, fetchImpl: input.fetchImpl });
  return provider.synthesize({
    text: input.text,
    voiceId: input.voiceId,
    format: input.format || "wav",
  });
}
