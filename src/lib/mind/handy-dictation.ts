export const HANDY_SOURCE = "https://github.com/cjpais/handy";
export const HANDY_ENGINE_SOURCE = "https://github.com/handy-computer/transcribe.cpp";
export const HANDY_WHISPER_URL = "http://127.0.0.1:4196/handy-stt";
export const HANDY_WAVE_BARS = 9;

/** Bar height from Handy's RecordingOverlay. Not a Google detector. */
export function handyBarHeight(level: number): number {
  const value = Math.max(0, Math.min(1, level));
  return Math.max(3, Math.min(18, 3 + Math.pow(value, 0.7) * 15));
}

export function handyLiveLevels(tick: number): number[] {
  return Array.from({ length: HANDY_WAVE_BARS }, (_, index) => {
    const wave = 0.35 + 0.55 * Math.abs(Math.sin(tick / 6 + index * 0.7));
    return Number(wave.toFixed(3));
  });
}

export function isTypingField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  if (typeof HTMLInputElement === "undefined") return false;
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return false;
  if (target.disabled || target.readOnly) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  const type = (target.type || "text").toLowerCase();
  return type === "text" || type === "search" || type === "email" || type === "url" || type === "tel";
}

export function fieldLabel(target: HTMLInputElement | HTMLTextAreaElement): string {
  return target.getAttribute("aria-label") || target.getAttribute("placeholder") || target.id || target.name || "field";
}

export function insertTranscript(target: HTMLInputElement | HTMLTextAreaElement, text: string): string {
  const next = text.trim();
  if (!next) return target.value;
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  const value = `${target.value.slice(0, start)}${next}${target.value.slice(end)}`;
  const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(target, value);
  target.dispatchEvent(new Event("input", { bubbles: true }));
  return value;
}
