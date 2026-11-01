/** Dev-only voice test audio helpers (URL ?voiceTestAudio=…). Never used in production builds. */

export type VoiceTestAudioKind = "hello" | "tone" | "path";

export function readVoiceTestAudioParam(
  search: string | null | undefined,
  isDev: boolean,
): string | null {
  if (!isDev) return null;
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = params.get("voiceTestAudio");
  if (!raw) return null;
  return raw.trim() || null;
}

export function resolveVoiceTestAudioUrl(raw: string): string {
  if (raw === "hello") return "/voice-test/hello.wav";
  if (raw === "tone") return "tone:440";
  if (raw.startsWith("/") || raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `/voice-test/${raw.replace(/^\.?\/?/, "")}`;
}

/** Decode a WAV ArrayBuffer into mono Float32 PCM + sample rate. */
export function decodeWavPcm(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(buffer);
  if (view.byteLength < 44) throw new Error("WAV too short");
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== "RIFF") throw new Error("Not a RIFF WAV");
  let offset = 12;
  let sampleRate = 24000;
  let channels = 1;
  let bits = 16;
  let dataOffset = -1;
  let dataBytes = 0;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    offset += 8;
    if (id === "fmt ") {
      channels = view.getUint16(offset + 2, true);
      sampleRate = view.getUint32(offset + 4, true);
      bits = view.getUint16(offset + 14, true);
    } else if (id === "data") {
      dataOffset = offset;
      // Some TTS WAVs advertise an absurd data size (e.g. 0x7fffffff). Clamp to file.
      const remaining = view.byteLength - dataOffset;
      dataBytes = Math.min(size > 0 ? size : remaining, remaining);
      break;
    }
    offset += size + (size % 2);
  }
  if (dataOffset < 0) throw new Error("WAV missing data chunk");
  const bytesPerFrame = (bits / 8) * channels;
  if (bytesPerFrame <= 0) throw new Error("Invalid WAV format");
  const frameCount = Math.floor(dataBytes / bytesPerFrame);
  const maxFrames = Math.floor((view.byteLength - dataOffset) / bytesPerFrame);
  const n = Math.min(frameCount, maxFrames);
  const samples = new Float32Array(n);
  if (bits === 16) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) {
        sum += view.getInt16(dataOffset + (i * channels + c) * 2, true) / 32768;
      }
      samples[i] = sum / channels;
    }
  } else {
    throw new Error(`Unsupported WAV bit depth ${bits}`);
  }
  return { samples, sampleRate };
}

/** Synthesize a short mono tone (Float32). */
export function synthesizeTone(sampleRate = 24000, seconds = 1.2, hz = 440): Float32Array {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t * 8) * Math.min(1, (seconds - t) * 8);
    out[i] = Math.sin(2 * Math.PI * hz * t) * 0.35 * env;
  }
  return out;
}

export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = src - i0;
    out[i] = input[i0]! * (1 - frac) + input[i1]! * frac;
  }
  return out;
}

/**
 * Dev dictation shortcut: map ?voiceTestAudio= kind to an insertable transcript
 * when the MediaRecorder path would only capture silence (fake mic / no device).
 */
export function dictationTranscriptForTestAudio(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (key === "hello") return "hello";
  if (key === "tone") return "tone";
  // Custom path/filename without extension → use basename as a stand-in label
  const base = key.split("/").pop() || key;
  const stem = base.replace(/\.wav$/i, "").trim();
  return stem || null;
}

/** Fetch bundled test WAV as a Blob for STT when available; null if tone: or fetch fails. */
export async function fetchVoiceTestAudioBlob(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ blob: Blob; mime: string } | null> {
  const url = resolveVoiceTestAudioUrl(raw);
  if (url.startsWith("tone:")) return null;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 64) return null;
    return { blob: new Blob([buf], { type: "audio/wav" }), mime: "audio/wav" };
  } catch {
    return null;
  }
}
