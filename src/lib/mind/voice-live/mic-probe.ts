/**
 * Mic preflight for live voice (box has no physical mic).
 * Ideas credited to Voice Integration Bot mic-probe.ts on voice-integration.
 *
 * CRITICAL (iOS Safari): getUserMedia MUST start in the same user-gesture turn.
 * Any await (enumerateDevices, network, etc.) before getUserMedia drops the
 * gesture — the prompt never appears and the call hangs until MIC_PROBE timeout (~8s).
 */

export type MicPreflightResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      code: "unavailable" | "no_device" | "denied" | "not_found" | "not_readable" | "other";
    };

export async function hasAudioInputDevice(
  enumerateDevices?: () => Promise<MediaDeviceInfo[]>,
): Promise<boolean> {
  const enumerate =
    enumerateDevices ??
    (() => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
        return Promise.resolve([] as MediaDeviceInfo[]);
      }
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
      error: "Microphone permission was denied. Allow the mic for this site, then try live voice again.",
    };
  }
  if (name === "NotFoundError" || /notfound|no device|requested device not found/i.test(message)) {
    return {
      ok: false,
      code: "not_found",
      error: "No microphone was found. Connect a mic, then try live voice again.",
    };
  }
  if (name === "NotReadableError" || /notreadable|track.*start|could not start/i.test(message)) {
    return {
      ok: false,
      code: "not_readable",
      error: "Microphone is busy or unreadable. Close other apps using the mic, then try again.",
    };
  }
  return { ok: false, code: "other", error: message || "Microphone could not be opened." };
}

/**
 * Kick getUserMedia first (sync call, async result), then map errors.
 * Do NOT await enumerateDevices before getUserMedia.
 */
export async function probeMicrophone(options?: {
  enumerateDevices?: () => Promise<MediaDeviceInfo[]>;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}): Promise<MicPreflightResult> {
  const getUserMedia =
    options?.getUserMedia ??
    (typeof navigator !== "undefined"
      ? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
      : undefined);
  if (!getUserMedia) {
    return { ok: false, code: "unavailable", error: "Microphone access is not available in this browser." };
  }

  // Start immediately — preserves user activation on iOS Safari.
  let streamPromise: Promise<MediaStream>;
  try {
    streamPromise = getUserMedia({ audio: true, video: false });
  } catch (caught) {
    return mapGetUserMediaError(caught);
  }

  try {
    const stream = await streamPromise;
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (caught) {
    const mapped = mapGetUserMediaError(caught);
    if (!mapped.ok) {
      if (mapped.code === "not_found" || mapped.code === "denied") return mapped;
      // Best-effort device hint after failure (gesture already used).
      const hasInput = await hasAudioInputDevice(options?.enumerateDevices);
      if (!hasInput && mapped.code === "other") {
        return {
          ok: false,
          code: "no_device",
          error: "No microphone was found. Connect a mic, then try live voice again.",
        };
      }
    }
    return mapped;
  }
}
