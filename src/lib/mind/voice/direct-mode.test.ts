import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DIRECT_FALLBACK_NOTICE,
  beginVoiceModeSession,
  defaultVoiceMode,
  hydrateResolvedVoiceMode,
  resolveVoiceMode,
  shouldPersistVoiceMode,
} from "./errors.ts";
import { readStoredVoiceMode, writeStoredVoiceMode, VOICE_MODE_STORAGE_KEY } from "./mode.ts";
import { runSpeakAction } from "./speak-action.ts";

describe("Direct voice mode", () => {
  it("defaults to Direct", () => {
    assert.equal(defaultVoiceMode(), "direct");
    assert.equal(resolveVoiceMode(undefined, false).mode, "direct");
    assert.equal(resolveVoiceMode("direct", false).fellBack, false);
  });

  it("preserves Orchestrator when unavailable; explicit separate Speak stages still run", async () => {
    const route = resolveVoiceMode("orchestrator", false);
    assert.equal(route.mode, "orchestrator");
    assert.equal(route.blocked, true);
    assert.equal(route.notice, DIRECT_FALLBACK_NOTICE);
    const order: string[] = [];
    const result = await runSpeakAction(
      { correlationId: "direct-1", text: "", messageId: "", voiceId: "Ara", chatCommitted: false, transcript: null, reply: null, audio: null },
      {
        capture: async () => {
          order.push("mic");
          return { ok: true, audioBase64: "bWlj" };
        },
        transcribe: async () => {
          order.push("stt");
          return { ok: true, text: "hello", provider: "OpenAI" };
        },
        chatTurn: async () => {
          order.push("chat");
          return { ok: true, text: "Hi.", provider: "OpenAI" };
        },
        synthesize: async () => {
          order.push("tts");
          return { ok: true, audio: "dHRz", provider: "OpenAI" };
        },
        play: async () => {
          order.push("play");
        },
      },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(order, ["mic", "stt", "chat", "tts", "play"]);
    assert.equal(JSON.stringify(result).includes("Orchestrator needs Ollama"), false);
  });

  it("preserves a saved orchestrator preference when the runtime is temporarily unavailable", () => {
    const store = new Map<string, string>([[VOICE_MODE_STORAGE_KEY, "orchestrator"]]);
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    assert.equal(shouldPersistVoiceMode(false), false);
    assert.equal(readStoredVoiceMode(storage), "orchestrator");
    const resolved = hydrateResolvedVoiceMode(store.get(VOICE_MODE_STORAGE_KEY), false);
    assert.equal(resolved, "orchestrator");
    assert.equal(shouldPersistVoiceMode(true, "orchestrator", false), true);
    writeStoredVoiceMode(resolved, storage);
    assert.equal(store.get(VOICE_MODE_STORAGE_KEY), "orchestrator");
  });

  it("blocks mint and connect when the selected Orchestrator is unavailable", async () => {
    let connected = "";
    let pending: Promise<unknown> = Promise.resolve();
    const button = createElement("button", {
      type: "button",
      "data-testid": "open-voice-mode",
      onClick: () => {
        pending = beginVoiceModeSession({
          mode: "orchestrator",
          pairedComputer: false,
          mint: async () => { throw new Error("must not mint"); },
          connect: async (secret) => {
            connected = secret;
          },
        });
      },
    });
    assert.match(renderToStaticMarkup(button), /data-testid="open-voice-mode"/);
    (button.props.onClick as () => void)();
    const started = await pending;
    assert.equal(connected, "");
    const shown = JSON.stringify(started);
    assert.equal(shown.includes("Orchestrator needs Ollama"), false);
    assert.match(shown, /preference is unchanged/);
    const view = renderToStaticMarkup(
      createElement("p", { "data-testid": "voice-notice" }, DIRECT_FALLBACK_NOTICE),
    );
    assert.match(view, /Orchestrator is unavailable/);
    assert.doesNotMatch(view, /Orchestrator needs Ollama/);
  });
});
