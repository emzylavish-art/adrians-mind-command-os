#!/usr/bin/env node
/**
 * Phase-1 voice round-trip against xAI Realtime (Speech-to-Speech).
 * Loads XAI_VOICE_API_KEY from env, else /home/box/.secrets/xai_voice.env.
 * Never prints key values.
 *
 * Docs:
 * - https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech
 * - https://docs.x.ai/developers/rest-api-reference/inference/voice
 * - https://docs.x.ai/developers/management-api-guide
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const ENDPOINT = 'wss://api.x.ai/v1/realtime?model=grok-voice-latest';
const MODEL = 'grok-voice-latest';
const SAMPLE_RATE = 24000;
const OUT_DIR = process.env.VOICE_TEST_DIR || '/workspace/voice-test';
const REPLY_WAV = join(OUT_DIR, 'reply.wav');
const PROMPT_WAV = join(OUT_DIR, 'prompt.wav');
const PROMPT_PCM = join(OUT_DIR, 'prompt.pcm');
const METRICS_JSON = join(OUT_DIR, 'roundtrip-metrics.json');

function loadVoiceKey() {
  if (process.env.XAI_VOICE_API_KEY) return process.env.XAI_VOICE_API_KEY;
  const p = '/home/box/.secrets/xai_voice.env';
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split(/\n/)) {
      const m = line.match(/^XAI_VOICE_API_KEY=(.*)$/);
      if (m) return m[1].trim();
    }
  }
  throw new Error('XAI_VOICE_API_KEY not set and secrets file missing');
}

function pcm16ToWav(pcmBuf, sampleRate) {
  const dataSize = pcmBuf.length;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  pcmBuf.copy(buf, 44);
  return buf;
}

function redact(s) {
  return String(s).replace(/xai-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
}

async function synthesizePromptPcm(apiKey, text) {
  const ttsRes = await fetch('https://api.x.ai/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      voice_id: 'eve',
      language: 'en',
      output_format: { codec: 'wav', sample_rate: SAMPLE_RATE },
    }),
  });
  if (!ttsRes.ok) {
    const errText = await ttsRes.text();
    throw new Error(`TTS failed HTTP ${ttsRes.status}: ${redact(errText).slice(0, 400)}`);
  }
  const contentType = ttsRes.headers.get('content-type') || '';
  let wavBytes;
  if (contentType.includes('application/json')) {
    const j = await ttsRes.json();
    if (!j.audio) throw new Error('TTS JSON missing audio field');
    wavBytes = Buffer.from(j.audio, 'base64');
  } else {
    wavBytes = Buffer.from(await ttsRes.arrayBuffer());
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const rawTts = join(OUT_DIR, 'prompt-tts.bin');
  writeFileSync(rawTts, wavBytes);
  const ff = spawnSync(
    'ffmpeg',
    ['-y', '-i', rawTts, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', PROMPT_PCM],
    { encoding: 'utf8' },
  );
  if (ff.status !== 0) {
    throw new Error(`ffmpeg decode failed: ${redact((ff.stderr || '').slice(-400))}`);
  }
  const pcm = readFileSync(PROMPT_PCM);
  writeFileSync(PROMPT_WAV, pcm16ToWav(pcm, SAMPLE_RATE));
  return pcm;
}

function chunkBase64(pcm, bytesPerChunk) {
  const out = [];
  for (let i = 0; i < pcm.length; i += bytesPerChunk) {
    out.push(pcm.subarray(i, i + bytesPerChunk).toString('base64'));
  }
  return out;
}

async function run() {
  const apiKey = loadVoiceKey();
  mkdirSync(OUT_DIR, { recursive: true });

  const promptText = process.env.VOICE_PROMPT_TEXT || 'Say hello in one word.';
  console.log(JSON.stringify({ step: 'tts_prompt', text: promptText, model: MODEL, endpoint: ENDPOINT }));
  const promptPcm = await synthesizePromptPcm(apiKey, promptText);
  const promptMs = Math.round((promptPcm.length / 2 / SAMPLE_RATE) * 1000);
  console.log(JSON.stringify({ step: 'prompt_ready', pcm_bytes: promptPcm.length, duration_ms: promptMs, path: PROMPT_WAV }));

  const chunks = chunkBase64(promptPcm, 4800);
  const silence = Buffer.alloc(Math.floor(SAMPLE_RATE * 2 * 0.5));
  const silenceChunks = chunkBase64(silence, 4800);

  const tConnectStart = performance.now();
  let tFirstAudioByte = null;
  let tResponseDone = null;
  const audioParts = [];
  const eventTypes = [];
  let errEvent = null;
  let outputTranscript = '';
  let sessionReady = false;
  let audioSent = false;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const timeout = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error(`roundtrip timeout 45000ms events=${eventTypes.join(',')}`));
    }, 45000);

    const send = (obj) => ws.send(JSON.stringify(obj));

    const sendAudioTurn = () => {
      if (audioSent) return;
      audioSent = true;
      for (const delta of chunks) {
        send({ type: 'input_audio_buffer.append', audio: delta });
      }
      for (const delta of silenceChunks) {
        send({ type: 'input_audio_buffer.append', audio: delta });
      }
      send({ type: 'input_audio_buffer.commit' });
      send({ type: 'response.create' });
      eventTypes.push('client.audio_committed');
    };

    ws.on('open', () => {
      eventTypes.push('ws.open');
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (tFirstAudioByte == null) tFirstAudioByte = performance.now();
        audioParts.push(Buffer.from(data));
        return;
      }
      let event;
      try { event = JSON.parse(String(data)); } catch { return; }
      eventTypes.push(event.type);

      if (event.type === 'error') {
        errEvent = { code: event.error?.code || event.code, message: event.error?.message || event.message };
      }

      if (event.type === 'session.created') {
        send({
          type: 'session.update',
          session: {
            voice: 'eve',
            instructions: 'You are a terse assistant. Reply with a single short spoken word.',
            turn_detection: null,
            audio: {
              input: { format: { type: 'audio/pcm', rate: SAMPLE_RATE } },
              output: { format: { type: 'audio/pcm', rate: SAMPLE_RATE } },
            },
          },
        });
      }

      if (event.type === 'session.updated') {
        sessionReady = true;
        sendAudioTurn();
      }

      if (event.type === 'response.output_audio.delta' || event.type === 'response.audio.delta') {
        if (tFirstAudioByte == null) tFirstAudioByte = performance.now();
        if (event.delta) audioParts.push(Buffer.from(event.delta, 'base64'));
      }
      if (event.type === 'response.output_audio_transcript.delta' || event.type === 'response.audio_transcript.delta') {
        outputTranscript += event.delta || '';
      }
      if (event.type === 'response.output_audio_transcript.done' || event.type === 'response.audio_transcript.done') {
        if (event.transcript) outputTranscript = event.transcript;
      }
      if (event.type === 'response.done') {
        tResponseDone = performance.now();
        clearTimeout(timeout);
        try { ws.close(); } catch { /* ignore */ }
        resolve();
      }
    });

    ws.on('error', (e) => {
      clearTimeout(timeout);
      reject(new Error(e.message || 'websocket error'));
    });

    ws.on('close', () => {
      if (tResponseDone == null && audioParts.length) {
        tResponseDone = performance.now();
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  if (errEvent && !audioParts.length) {
    throw new Error(`voice error: ${JSON.stringify(errEvent)}`);
  }
  if (!audioParts.length) {
    throw new Error(`no audio received; sessionReady=${sessionReady}; events=${eventTypes.join(',')}`);
  }

  const pcmOut = Buffer.concat(audioParts);
  writeFileSync(REPLY_WAV, pcm16ToWav(pcmOut, SAMPLE_RATE));

  const metrics = {
    endpoint: ENDPOINT,
    model: MODEL,
    prompt_path: PROMPT_WAV,
    reply_path: REPLY_WAV,
    prompt_duration_ms: promptMs,
    reply_pcm_bytes: pcmOut.length,
    reply_duration_ms: Math.round((pcmOut.length / 2 / SAMPLE_RATE) * 1000),
    time_to_first_audio_byte_ms: tFirstAudioByte == null ? null : Math.round(tFirstAudioByte - tConnectStart),
    total_round_trip_ms: tResponseDone == null ? null : Math.round(tResponseDone - tConnectStart),
    output_transcript: outputTranscript,
    event_types: eventTypes.slice(0, 60),
    error: errEvent,
    measured_at: new Date().toISOString(),
    docs: [
      'https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech',
      'https://docs.x.ai/developers/rest-api-reference/inference/voice',
      'https://docs.x.ai/developers/management-api-guide',
    ],
  };
  writeFileSync(METRICS_JSON, JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify({ step: 'done', ...metrics }, null, 2));
}

run().catch((e) => {
  console.error(JSON.stringify({ step: 'failed', error: redact(e.message) }));
  process.exit(1);
});
