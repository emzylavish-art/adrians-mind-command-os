/** Honest screen-share audio policy for live voice. */

export type ScreenAudioStatus =
  | { ok: true; hasAudio: boolean; notice: string | null }
  | { ok: false; error: string };

/**
 * After getDisplayMedia resolves, describe audio availability.
 * Live voice currently mixes mic PCM only — if the browser gave display audio
 * tracks we still tell the owner they are not routed into the call.
 */
export function describeScreenAudio(stream: { getAudioTracks: () => unknown[] }): ScreenAudioStatus {
  const hasAudio = stream.getAudioTracks().length > 0;
  if (!hasAudio) {
    return {
      ok: true,
      hasAudio: false,
      notice: "Screen audio is not available — sharing video only (no tab/system sound).",
    };
  }
  return {
    ok: true,
    hasAudio: true,
    notice:
      "Screen audio was offered by the browser, but live voice still uses your mic — display audio is not mixed into the call yet.",
  };
}

export function screenShareUnavailableMessage(): string {
  return "Screen share was cancelled or isn't available.";
}
