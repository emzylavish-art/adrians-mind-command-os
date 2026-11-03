/**
 * Magic-byte sniff so a renamed PDF/text file cannot pass as a voice sample.
 */
import { audioMimeBase } from "./limits.ts";

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

export function sniffAudioMagic(
  bytes: Uint8Array,
  mime: string,
): { ok: true } | { ok: false; error: string; code: string } {
  if (bytes.length < 12) {
    return { ok: false, error: "Audio payload is too short to verify.", code: "bad_audio" };
  }
  const base = audioMimeBase(mime);
  const isWav =
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45;
  const isOgg = startsWith(bytes, [0x4f, 0x67, 0x67, 0x53]);
  const isWebm = startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
  const isId3 = startsWith(bytes, [0x49, 0x44, 0x33]);
  const isMp3Frame = bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
  const isFtyp =
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70;
  const isPdf = startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);
  if (isPdf) {
    return { ok: false, error: "File is not audio (PDF detected).", code: "bad_audio" };
  }
  const head = String.fromCharCode(...bytes.slice(0, 8));
  if (/^(<!DOCTYPE|<html|\{|\[|#)/i.test(head)) {
    return { ok: false, error: "File is not audio (text/document detected).", code: "bad_audio" };
  }

  const looksAudio = isWav || isOgg || isWebm || isId3 || isMp3Frame || isFtyp;
  if (!looksAudio) {
    return {
      ok: false,
      error: "Audio bytes do not match a known audio container. Renamed non-audio files are rejected.",
      code: "bad_audio",
    };
  }
  if (base.includes("wav") && !isWav) {
    return { ok: false, error: "Declared WAV but bytes are not RIFF/WAVE.", code: "bad_mime" };
  }
  if ((base.includes("mpeg") || base === "audio/mp3") && !(isId3 || isMp3Frame)) {
    return { ok: false, error: "Declared MP3 but bytes are not MPEG audio.", code: "bad_mime" };
  }
  if (base.includes("ogg") && !isOgg) {
    return { ok: false, error: "Declared OGG but bytes are not OggS.", code: "bad_mime" };
  }
  if (base.includes("webm") && !isWebm) {
    return { ok: false, error: "Declared WebM but bytes are not EBML.", code: "bad_mime" };
  }
  return { ok: true };
}

export function looksLikeWavHeader(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  );
}

export function looksLikeMp3Header(bytes: Uint8Array): boolean {
  if (bytes.length < 3) return false;
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return true;
  return bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
}
