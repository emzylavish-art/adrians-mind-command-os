/** Preflight mic checks and getUserMedia error mapping (no MediaStream kept). */

export type MicPreflightResult =
  | { ok: true }
  | { ok: false; error: string; code: "unavailable" | "no_device" | "denied" | "not_found" | "not_readable" | "other" };

export async function hasAudioInputDevice(
  enumerateDevices?: () => Promise<MediaDeviceInfo[]>,
): Promise<boolean> {
  const enumerate =
    enumerateDevices ??
    (() => {
      if (!navigator.mediaDevices?.enumerateDevices) return Promise.resolve([] as MediaDeviceInfo[]);
      return navigator.mediaDevices.enumerateDevices();
    });
  try {
    const devices = await enumerate();
    return devices.some((d) => d.kind === "audioinput");
  } catch {
    return false;
  }
}

export function mapGetUserMediaError(caught: unknown): MicPreflightResult {
  const name =
    caught && typeof caught === "object" && "name" in caught
      ? String((caught as { name?: string }).name || "")
      : "";
  const message = caught instanceof Error ? caught.message : String(caught || "Unknown error");
  if (name === "NotAllowedError" || /permission|notallowed|denied/i.test(message)) {
    return {
      ok: false,
      code: "denied",
      error: "Microphone permission was denied. Allow mic access in the browser, then Retry.",
    };
  }
  if (name === "NotFoundError" || /notfound|no device|requested device not found/i.test(message)) {
    return {
      ok: false,
      code: "not_found",
      error: "No microphone found. Connect a mic (or use ?voiceTestAudio=hello in local preview), then Retry.",
    };
  }
  if (name === "NotReadableError" || /notreadable|track.*start|could not start/i.test(message)) {
    return {
      ok: false,
      code: "not_readable",
      error: "Microphone is busy or unreadable. Close other apps using the mic, then Retry.",
    };
  }
  return { ok: false, code: "other", error: message || "Microphone could not be opened." };
}

/**
 * Fail fast when no audioinput exists; otherwise open+close a short getUserMedia probe.
 * Avoids hanging 10s when the box has zero capture devices.
 */
export async function probeMicrophone(options?: {
  enumerateDevices?: () => Promise<MediaDeviceInfo[]>;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}): Promise<MicPreflightResult> {
  if (!options?.getUserMedia && !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, code: "unavailable", error: "Microphone access is not available in this browser." };
  }
  const hasInput = await hasAudioInputDevice(options?.enumerateDevices);
  if (!hasInput) {
    return {
      ok: false,
      code: "no_device",
      error: "No microphone found. Connect a mic (or use ?voiceTestAudio=hello in local preview), then Retry.",
    };
  }
  const getUserMedia =
    options?.getUserMedia ??
    ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));
  try {
    const stream = await getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (caught) {
    return mapGetUserMediaError(caught);
  }
}
