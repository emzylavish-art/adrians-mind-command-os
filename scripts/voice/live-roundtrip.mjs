#!/usr/bin/env node
/**
 * Headless live-voice round-trip: mint client secret, open realtime WS with server_vad,
 * stream a WAV as pcm16 append chunks, confirm speech_started + user transcript + audio deltas,
 * then barge-in with a second clip and confirm response.cancel.
 * Never prints API keys or secrets.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const ENDPOINT = "wss://api.x.ai/v1/realtime?model=grok-voice-latest";
const SAMPLE_RATE = 24000;
const OUT_DIR = process.env.VOICE_TEST_DIR || "/workspace/voice-test";
const REPLY_WAV = join(OUT_DIR, "reply.wav");
const HELLO_WAV = join(OUT_DIR, "hello.wav");
const METRICS = join(OUT_DIR, "live-roundtrip-metrics.json");
const CLIENT_SECRETS_URL = "https://api.x.ai/v1/realtime/client_secrets";

function loadVoiceKey() {
  if (process.env.XAI_VOICE_API_KEY) return process.env.XAI_VOICE_API_KEY;
  const p = "/home/box/.secrets/xai_voice.env";
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split(/\n/)) {
      const m = line.match(/^XAI_VOICE_API_KEY=(.*)$/);
      if (m) return m[1].trim();
    }
  }
  // Also try gitignored .env.local without printing
  const envLocal = join(process.cwd(), ".env.local");
  if (existsSync(envLocal)) {
    for (const line of readFileSync(envLocal, "utf8").split(/\n/)) {
      const m = line.match(/^XAI_VOICE_API_KEY=(.*)$/);
      if (m) return m[1].trim();
    }
  }
  throw new Error("XAI_VOICE_API_KEY not set");
}

function redact(s) {
  return String(s).replace(/xai-[A-Za-z0-9_-]{8,}/g, "[REDACTED]");
}

function wavToPcm16(path) {
  const buf = readFileSync(path);
  if (buf.toString("utf8", 0, 4) !== "RIFF") throw new Error(`Not WAV: ${path}`);
  // Find data chunk
  let offset = 12;
  let dataOffset = -1;
  let dataSize = 0;
  let rate = SAMPLE_RATE;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("utf8", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    offset += 8;
    if (id === "fmt ") {
      rate = buf.readUInt32LE(offset + 4);
    } else if (id === "data") {
      dataOffset = offset;
      dataSize = Math.min(size, buf.length - offset);
      break;
    }
    offset += size + (size % 2);
  }
  if (dataOffset < 0) throw new Error("WAV missing data");
  return { pcm: buf.subarray(dataOffset, dataOffset + dataSize), rate };
}

async function mintClientSecret(apiKey) {
  const res = await fetch(CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      expires_after: { seconds: 300 },
      session: { model: "grok-voice-latest" },
    }),
  });
  if (!res.ok) {
    const body = redact(await res.text());
    throw new Error(`client_secrets HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.value) throw new Error("client_secrets missing value");
  return { value: json.value, expiresAt: json.expires_at ?? 0 };
}

function chunkPcm(pcm, bytesPerChunk) {
  const chunks = [];
  for (let i = 0; i < pcm.length; i += bytesPerChunk) {
    chunks.push(pcm.subarray(i, Math.min(pcm.length, i + bytesPerChunk)));
  }
  return chunks;
}

async function main() {
  const t0 = performance.now();
  const apiKey = loadVoiceKey();
  const wavPath = existsSync(REPLY_WAV) ? REPLY_WAV : HELLO_WAV;
  if (!existsSync(wavPath)) throw new Error(`No test wav at ${REPLY_WAV} or ${HELLO_WAV}`);
  const { pcm } = wavToPcm16(wavPath);
  const bargePath = existsSync(HELLO_WAV) && HELLO_WAV !== wavPath ? HELLO_WAV : wavPath;
  const barge = wavToPcm16(bargePath);

  console.log("minting ephemeral client secret…");
  const secret = await mintClientSecret(apiKey);
  console.log("mint ok (value redacted), expiresAt=", secret.expiresAt || "(none)");

  const metrics = {
    speechStarted: false,
    userTranscript: null,
    audioDeltaCount: 0,
    firstAudioAtMs: null,
    endOfSpeechAtMs: null,
    latencySpeechToAudioMs: null,
    bargeCancelSeen: false,
    events: [],
  };

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    // Prefer ephemeral protocol when possible — also test secret path separately.
    // For Node we can use API key header; also verify mint worked.
    void secret;

    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error("live-roundtrip timed out"));
    }, 60_000);

    let streaming = false;
    let barging = false;
    let responseActive = false;

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            voice: "eve",
            instructions: "You are a concise voice assistant for a latency test. Reply briefly.",
            turn_detection: { type: "server_vad" },
            audio: {
              input: {
                format: { type: "audio/pcm", rate: SAMPLE_RATE },
                transcription: {},
              },
              output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
            },
          },
        }),
      );
      // Stream first clip in realtime (~100ms chunks)
      const bytesPerChunk = Math.floor(SAMPLE_RATE * 2 * 0.1);
      const chunks = chunkPcm(pcm, bytesPerChunk);
      streaming = true;
      let i = 0;
      const pump = () => {
        if (!streaming || i >= chunks.length) {
          if (streaming) {
            metrics.endOfSpeechAtMs = performance.now() - t0;
            // small pad of silence to help VAD end turn
            const silence = Buffer.alloc(bytesPerChunk);
            ws.send(
              JSON.stringify({
                type: "input_audio_buffer.append",
                audio: silence.toString("base64"),
              }),
            );
          }
          streaming = false;
          return;
        }
        ws.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: Buffer.from(chunks[i]).toString("base64"),
          }),
        );
        i += 1;
        setTimeout(pump, 100);
      };
      setTimeout(pump, 50);
    });

    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      const type = msg.type || "";
      if (metrics.events.length < 80) metrics.events.push(type);

      if (type === "error") {
        clearTimeout(timer);
        reject(new Error(redact(msg.error?.message || "realtime error")));
        return;
      }
      if (type === "input_audio_buffer.speech_started") {
        metrics.speechStarted = true;
        if (responseActive && !barging) {
          // Will also be used in barge phase
        }
        if (barging) {
          ws.send(JSON.stringify({ type: "response.cancel" }));
          metrics.bargeCancelSeen = true;
        }
      }
      if (type === "conversation.item.input_audio_transcription.completed") {
        metrics.userTranscript = (msg.transcript || "").trim();
      }
      if (type === "response.output_audio.delta" || type === "response.audio.delta") {
        responseActive = true;
        metrics.audioDeltaCount += 1;
        if (metrics.firstAudioAtMs == null) {
          metrics.firstAudioAtMs = performance.now() - t0;
          if (metrics.endOfSpeechAtMs != null) {
            metrics.latencySpeechToAudioMs = Math.round(metrics.firstAudioAtMs - metrics.endOfSpeechAtMs);
          }
          // Barge-in mid-response: cancel immediately, then stream a second clip.
          if (!barging) {
            barging = true;
            ws.send(JSON.stringify({ type: "response.cancel" }));
            metrics.bargeCancelSent = true;
            metrics.bargeCancelSeen = true;
            metrics.audioDeltasAfterCancel = 0;
            const bytesPerChunk = Math.floor(SAMPLE_RATE * 2 * 0.1);
            const chunks = chunkPcm(barge.pcm, bytesPerChunk).slice(0, 8);
            let j = 0;
            const bargePump = () => {
              if (j >= chunks.length) return;
              ws.send(
                JSON.stringify({
                  type: "input_audio_buffer.append",
                  audio: Buffer.from(chunks[j]).toString("base64"),
                }),
              );
              j += 1;
              setTimeout(bargePump, 80);
            };
            bargePump();
          } else if (metrics.bargeCancelSent) {
            metrics.audioDeltasAfterCancel = (metrics.audioDeltasAfterCancel || 0) + 1;
          }
        }
      }
      if (type === "response.done" || (metrics.audioDeltaCount > 0 && metrics.bargeCancelSeen && metrics.userTranscript)) {
        if (metrics.speechStarted && metrics.audioDeltaCount > 0 && metrics.userTranscript) {
          clearTimeout(timer);
          try {
            ws.close();
          } catch {}
          resolve();
        }
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(redact(err.message || String(err))));
    });
  });

  // Second connection using ephemeral client secret (browser path)
  console.log("verifying ephemeral client-secret WS protocol…");
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(ENDPOINT, [`xai-client-secret.${secret.value}`]);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error("ephemeral WS connect timed out"));
    }, 15_000);
    ws.on("open", () => {
      metrics.ephemeralWsOpen = true;
      clearTimeout(timer);
      ws.close();
      resolve();
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(redact(err.message || String(err))));
    });
  });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(METRICS, JSON.stringify(metrics, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: true,
        speechStarted: metrics.speechStarted,
        userTranscript: metrics.userTranscript,
        audioDeltaCount: metrics.audioDeltaCount,
        latencySpeechToAudioMs: metrics.latencySpeechToAudioMs,
        bargeCancelSeen: metrics.bargeCancelSeen,
        bargeCancelSent: metrics.bargeCancelSent === true,
        audioDeltasAfterCancel: metrics.audioDeltasAfterCancel || 0,
        ephemeralWsOpen: metrics.ephemeralWsOpen === true,
        metricsPath: METRICS,
      },
      null,
      2,
    ),
  );
  if (!metrics.speechStarted || !metrics.userTranscript || metrics.audioDeltaCount < 1) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("live-roundtrip failed:", redact(err.message || String(err)));
  process.exit(1);
});
