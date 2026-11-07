import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { onceRetry } from "../retry-fidelity.ts";
import type { SpeakRetryParams } from "./speak-action.ts";
import { runMountedSpeak, type SpeakMountedInput } from "./speak-click.ts";

const commandApp = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../components/mind/command-app.tsx"), "utf8");

type Banner = { message: string; kind: string; retry: (() => void) | null } | null;

/** Same banner contract command-app renders after reportFailure. */
function BannerHost(props: { banner: Banner; onDismiss: () => void }) {
  if (!props.banner) return null;
  return createElement(
    "div",
    {
      className: "flex flex-wrap items-center justify-between gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2",
      role: "alert",
      "data-testid": "failure-banner",
      "data-failure-kind": props.banner.kind,
    },
    createElement("p", { className: "text-sm text-danger" }, props.banner.message),
    createElement(
      "div",
      { className: "flex flex-wrap gap-2" },
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "failure-retry",
          onClick: () => props.banner?.retry?.(),
        },
        "Retry",
      ),
      createElement(
        "button",
        { type: "button", "data-testid": "failure-dismiss", onClick: props.onDismiss },
        "Dismiss",
      ),
    ),
  );
}

function harness(deps: SpeakMountedInput["deps"]) {
  let generation = 0;
  let banner: Banner = null;
  let attempts: SpeakRetryParams[] = [];
  const reportFailure: SpeakMountedInput["reportFailure"] = (message, action, _target, retry) => {
    banner = { message, kind: action, retry: onceRetry(retry) };
  };
  const clearFailure = () => {
    banner = null;
  };
  const again = (params: SpeakRetryParams) => {
    attempts.push(params);
    void run(params.text, params.messageId, params.voiceId, params);
  };
  async function run(text: string, messageId: string, voiceId: string, replay?: SpeakRetryParams) {
    const mine = ++generation;
    return runMountedSpeak({
      text,
      messageId,
      voiceId,
      replay,
      isCurrent: () => mine === generation,
      deps,
      reportFailure,
      clearFailure,
      again,
    });
  }
  return {
    run,
    dismiss: () => {
      generation += 1;
      clearFailure();
    },
    banner: () => banner,
    attempts: () => attempts,
  };
}

function sourceBetween(start: string, end: string) {
  const from = commandApp.indexOf(start);
  const to = commandApp.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} .. ${end}`);
  return commandApp.slice(from, to);
}

describe("mounted Speak click", () => {
  it("runs mic, STT, the composer deliver(), TTS, and playback in that order", async () => {
    const speakTurn = sourceBetween("async function speakChatTurn", "async function speak(");
    const composer = sourceBetween("async function sendCommand", "async function startResearch");
    assert.match(speakTurn, /const reply = await deliver\(chat, transcript, source\)/);
    assert.doesNotMatch(speakTurn, /fetch\(|consumeMindTurn|\/api\/mind\/turn/);
    assert.match(composer, /await deliver\(made\.chat, full,/);
    assert.match(commandApp, /onCompactSpeak=\{\(\) => void speak\(""\)\}/);
    assert.match(commandApp, /chatTurn: \(transcript\) => speakChatTurn\(transcript\)/);

    const order: string[] = [];
    const delivered: string[] = [];
    async function deliver(text: string) {
      delivered.push(text);
      return "It is sunny.";
    }
    let pending: Promise<unknown> = Promise.resolve();
    const composerButton = createElement("button", {
      type: "button",
      "data-testid": "composer-send",
      onClick: () => {
        void deliver("typed hello");
      },
    });
    const button = createElement("button", {
      type: "button",
      "data-testid": "composer-speak",
      onClick: () => {
        pending = runMountedSpeak({
          text: "",
          messageId: "",
          voiceId: "Ara",
          isCurrent: () => true,
          deps: {
            capture: async () => {
              order.push("mic");
              return { ok: true, audioBase64: "bWlj" };
            },
            transcribe: async (audio) => {
              order.push("stt");
              assert.equal(audio, "bWlj");
              return { ok: true, text: "what is the weather" };
            },
            chatTurn: async (transcript) => {
              order.push("chat");
              const reply = await deliver(transcript);
              if (!reply) return { ok: false, error: "The chat turn failed. Nothing was spoken." };
              return { ok: true, text: reply };
            },
            synthesize: async (reply) => {
              order.push("tts");
              assert.equal(reply, "It is sunny.");
              return { ok: true, audio: "dHRz" };
            },
            play: async (audio) => {
              order.push("play");
              assert.equal(audio, "dHRz");
            },
          },
          reportFailure: () => undefined,
          clearFailure: () => undefined,
          again: () => undefined,
        });
      },
    });
    assert.match(renderToStaticMarkup(composerButton), /data-testid="composer-send"/);
    assert.match(renderToStaticMarkup(button), /data-testid="composer-speak"/);
    (composerButton.props.onClick as () => void)();
    (button.props.onClick as () => void)();
    await pending;
    assert.deepEqual(order, ["mic", "stt", "chat", "tts", "play"]);
    assert.deepEqual(delivered, ["typed hello", "what is the weather"]);
  });
});

describe("mounted speak() failure banner", () => {
  it("speak() reports failures through reportFailure and the shared failure mount", () => {
    assert.match(commandApp, /async function speak\(/);
    assert.match(commandApp, /runMountedSpeak\(/);
    assert.match(commandApp, /reportFailure\(message, action, target, retry\)/);
    assert.match(commandApp, /failure-mount/);
  });

  it("shows the banner, retries identical params once, and dismiss clears it", async () => {
    const original = {
      text: "  Speak this exactly \n",
      messageId: "msg-42",
      voiceId: "Ara ",
    };
    let synths = 0;
    const host = harness({
      synthesize: async () => {
        synths += 1;
        return { ok: false, error: "The browser blocked playback." };
      },
      play: async () => undefined,
    });
    await host.run(original.text, original.messageId, original.voiceId);
    const html = renderToStaticMarkup(createElement(BannerHost, { banner: host.banner(), onDismiss: host.dismiss }));
    assert.match(html, /data-testid="failure-banner"/);
    assert.match(html, /The browser blocked playback/);
    host.banner()?.retry?.();
    host.banner()?.retry?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(synths, 2);
    assert.equal(host.attempts().length, 1);
    assert.equal(host.attempts()[0]?.text, original.text);
    assert.equal(host.attempts()[0]?.messageId, original.messageId);
    assert.equal(host.attempts()[0]?.voiceId, original.voiceId);
    host.dismiss();
    assert.equal(host.banner(), null);
    const cleared = renderToStaticMarkup(createElement(BannerHost, { banner: host.banner(), onDismiss: host.dismiss }));
    assert.equal(cleared, "");
  });

  it("drops a stale error after a newer success and a stale success after a newer error", async () => {
    let releaseFirst: (value: unknown) => void = () => undefined;
    const first = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const host = harness({
      synthesize: async () => {
        calls += 1;
        if (calls === 1) return first;
        return { ok: false, error: "Failed to fetch" };
      },
      play: async () => undefined,
    });
    const older = host.run("  first  ", "m1", "eve");
    const newer = await host.run("  second  ", "m2", "eve");
    assert.equal(newer.ok, false);
    assert.match(host.banner()?.message ?? "", /Failed to fetch|voice request|connection/i);
    releaseFirst({ ok: true, audio: "aud" });
    await older;
    assert.match(host.banner()?.message ?? "", /Failed to fetch|voice request|connection/i);
    host.dismiss();
    let releaseError: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      releaseError = resolve;
    });
    calls = 0;
    const host2 = harness({
      synthesize: async () => {
        calls += 1;
        if (calls === 1) return pending;
        return { ok: true, audio: "aud" };
      },
      play: async () => undefined,
    });
    const late = host2.run("  late  ", "m3", "eve");
    const success = await host2.run("  ok  ", "m4", "eve");
    assert.equal(success.ok, true);
    assert.equal(host2.banner(), null);
    releaseError({ ok: false, error: "Failed to fetch" });
    await late;
    assert.equal(host2.banner(), null);
  });

  it("does not start STT/chat/TTS when capture resolves after the attempt is superseded", async () => {
    let releaseCapture: (value: unknown) => void = () => undefined;
    const capture = new Promise<unknown>((resolve) => { releaseCapture = resolve; });
    let current = true;
    let transcribe = 0, chat = 0, synthesize = 0, play = 0, failures = 0;
    const run = runMountedSpeak({
      text: "", messageId: "", voiceId: "eve", isCurrent: () => current,
      deps: {
        capture: () => capture,
        transcribe: async () => { transcribe += 1; return { ok: true, text: "hello" }; },
        chatTurn: async () => { chat += 1; return { ok: true, text: "reply" }; },
        synthesize: async () => { synthesize += 1; return { ok: true, audio: "audio" }; },
        play: async () => { play += 1; },
      },
      reportFailure: () => { failures += 1; }, clearFailure: () => undefined, again: () => undefined,
    });
    current = false;
    releaseCapture({ ok: true, audioBase64: "captured" });
    const result = await run;
    assert.equal(result.ok, false);
    assert.deepEqual([transcribe, chat, synthesize, play, failures], [0, 0, 0, 0, 0]);
  });

  it("does not begin playback when TTS resolves after the attempt is superseded", async () => {
    let releaseSpeech: (value: unknown) => void = () => undefined;
    const speech = new Promise<unknown>((resolve) => { releaseSpeech = resolve; });
    let current = true, play = 0, failures = 0;
    const run = runMountedSpeak({
      text: "reply", messageId: "m1", voiceId: "eve",
      replay: { correlationId: "c1", chatCommitted: true, transcript: "hello", reply: "reply", audio: null, text: "", messageId: "m1", voiceId: "eve" },
      isCurrent: () => current,
      deps: { synthesize: async () => speech, play: async () => { play += 1; } },
      reportFailure: () => { failures += 1; }, clearFailure: () => undefined, again: () => undefined,
    });
    current = false;
    releaseSpeech({ ok: true, audio: "audio" });
    const result = await run;
    assert.equal(result.ok, false);
    assert.deepEqual([play, failures], [0, 0]);
  });
});

void useState;
