/**
 * Gap#10 — focus requests while the camera is gliding.
 * Latest request wins: selection updates immediately; camera may retarget mid-flight.
 * Unknown ids clear selection (no stale Star Detail).
 */

export type FocusBotLike = { id: string };

export type FocusRequestResult =
  | { kind: "clear"; pendingId: null; startCamera: false }
  | {
      kind: "select";
      botId: string;
      /** Always retarget when preferRetarget; otherwise only when not gliding. */
      startCamera: boolean;
      /** When not starting now, stash this id (latest-wins overwrite). */
      pendingId: string | null;
    };

/**
 * Resolve one programmatic focus request (palette / feed / dash3d-focus-bot).
 * @param preferRetarget when true (Dashboard default), interrupt an in-flight glide.
 */
export function resolveFocusBotRequest(
  botId: string | null | undefined,
  bots: ReadonlyArray<FocusBotLike>,
  opts: { gliding: boolean; preferRetarget?: boolean } = { gliding: false },
): FocusRequestResult {
  const preferRetarget = opts.preferRetarget !== false;
  if (botId == null || botId === "" || typeof botId !== "string") {
    return { kind: "clear", pendingId: null, startCamera: false };
  }
  const found = bots.some((b) => b && b.id === botId);
  if (!found) {
    return { kind: "clear", pendingId: null, startCamera: false };
  }
  const startCamera = preferRetarget || !opts.gliding;
  return {
    kind: "select",
    botId,
    startCamera,
    pendingId: startCamera ? null : botId,
  };
}

/** Latest-wins pending slot: newer id replaces older; null clears. */
export function writePendingFocus(
  _prev: string | null,
  next: string | null | undefined,
): string | null {
  if (next == null || next === "") return null;
  return next;
}

/** Take pending for flush after glide; returns [id, clearedState]. */
export function takePendingFocus(pending: string | null): {
  id: string | null;
  pendingId: null;
} {
  return { id: pending, pendingId: null };
}
