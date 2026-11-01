#!/usr/bin/env node
/**
 * Live voice-integration verification against xAI.
 * Loads XAI_VOICE_API_KEY from env or /home/box/.secrets/xai_voice.env.
 * Never prints key values. Writes /workspace/voice-test/integration-verify.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const OUT = process.env.VOICE_TEST_DIR || '/workspace/voice-test';
const SAMPLE_RATE = 24000;

function loadKey() {
  if (process.env.XAI_VOICE_API_KEY) return process.env.XAI_VOICE_API_KEY;
  const p = '/home/box/.secrets/xai_voice.env';
  if (!existsSync(p)) throw new Error('XAI_VOICE_API_KEY missing');
  for (const line of readFileSync(p, 'utf8').split(/\n/)) {
    const m = line.match(/^XAI_VOICE_API_KEY=(.*)$/);
    if (m) return m[1].trim();
  }
  throw new Error('XAI_VOICE_API_KEY missing in secrets file');
}

function redact(s) {
  return String(s).replace(/xai-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
}

function chunkBase64(buf, n) {
  const out = [];
  for (let i = 0; i < buf.length; i += n) out.push(buf.subarray(i, i + n).toString('base64'));
  return out;
}

async function mint(key) {
  const res = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_after: { seconds: 180 } }),
  });
  const json = await res.json();
  return { status: res.status, hasValue: Boolean(json.value), value: json.value, expires_at: json.expires_at ?? null };
}

async function tts(key, text) {
  const res = await fetch('https://api.x.ai/v1/tts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: 'eve', language: 'en', output_format: { codec: 'wav', sample_rate: SAMPLE_RATE } }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bytes: buf.length, content_type: res.headers.get('content-type') };
}

async function stt(key, wavPath) {
  const wav = readFileSync(wavPath);
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'prompt.wav');
  form.append('model', 'grok-voice-transcribe-2.0');
  const res = await fetch('https://api.x.ai/v1/stt', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, text: json.text || null, duration: json.duration ?? null };
}

async function captureOnlyRoundtrip(secret, pcm) {
  const events = [];
  let transcript = null;
  let forceAudioBytes = 0;
  await new Promise((resolve) => {
    const ws = new WebSocket('wss://api.x.ai/v1/realtime?model=grok-voice-latest', {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const timer = setTimeout(() => { try { ws.close(); } catch {}; resolve(); }, 25000);
    const send = (o) => ws.send(JSON.stringify(o));
    let forceSent = false;
    ws.on('message', (data, isBinary) => {
      if (isBinary) { forceAudioBytes += Buffer.from(data).length; return; }
      const msg = JSON.parse(String(data));
      events.push(msg.type);
      if (msg.type === 'session.created') {
        send({
          type: 'session.update',
          session: {
            voice: 'eve',
            instructions: 'Listen only. Do not answer unless force_message.',
            turn_detection: { type: 'server_vad' },
            audio: {
              input: { format: { type: 'audio/pcm', rate: SAMPLE_RATE } },
              output: { format: { type: 'audio/pcm', rate: SAMPLE_RATE } },
            },
          },
        });
      }
      if (msg.type === 'session.updated') {
        const silence = Buffer.alloc(SAMPLE_RATE * 2);
        (async () => {
          for (const part of [...chunkBase64(pcm, 4800), ...chunkBase64(silence, 4800)]) {
            send({ type: 'input_audio_buffer.append', audio: part });
            await new Promise((r) => setTimeout(r, 95));
          }
          events.push('client.streamed');
        })();
      }
      if (msg.type === 'response.created' && !forceSent) {
        send({ type: 'response.cancel' });
        events.push('auto_cancelled');
      }
      if (msg.type === 'conversation.item.input_audio_transcription.completed') {
        transcript = (msg.transcript || '').trim();
        events.push('TX:' + transcript);
      }
      if (msg.type === 'response.done' && transcript && !forceSent) {
        forceSent = true;
        send({
          type: 'conversation.item.create',
          item: {
            type: 'force_message',
            role: 'assistant',
            interruptible: true,
            content: [{ type: 'output_text', text: 'Heard you.' }],
          },
        });
        events.push('force_sent');
      }
      if (msg.type === 'response.output_audio.delta' && msg.delta) {
        forceAudioBytes += Buffer.from(msg.delta, 'base64').length;
      }
      if (msg.type === 'response.done' && forceSent && events.filter((e) => e === 'response.done').length >= 2) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve();
      }
      if (msg.type === 'error') events.push('ERR:' + redact(msg.error?.message || ''));
    });
    ws.on('close', () => { clearTimeout(timer); resolve(); });
    ws.on('error', () => { events.push('ws_error'); });
  });
  return { transcript, forceAudioBytes, events: events.slice(0, 80) };
}

const key = loadKey();
mkdirSync(OUT, { recursive: true });
const report = { at: new Date().toISOString(), zone: 'Africa/Lagos (UTC+1)', checks: {} };
report.checks.client_secret = await mint(key);
const secret = report.checks.client_secret.value;
delete report.checks.client_secret.value;
report.checks.tts = await tts(key, 'Integration speaking check.');
const wav = join(OUT, 'prompt.wav');
if (!existsSync(wav)) throw new Error('missing prompt.wav — run scripts/voice/roundtrip.mjs first');
report.checks.stt_rest = await stt(key, wav);
const pcm = readFileSync(join(OUT, 'prompt.pcm'));
report.checks.capture_only_then_force = await captureOnlyRoundtrip(secret, pcm);
report.ok = Boolean(
  report.checks.client_secret.status === 200 &&
  report.checks.tts.status === 200 &&
  report.checks.tts.bytes > 1000 &&
  report.checks.stt_rest.status === 200 &&
  report.checks.stt_rest.text &&
  report.checks.capture_only_then_force.transcript &&
  report.checks.capture_only_then_force.forceAudioBytes > 1000,
);
writeFileSync(join(OUT, 'integration-verify.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 2);
