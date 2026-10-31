export function canChangeHalt(callerId: string | null, ownerId: string | null, turningOff: boolean): { ok: true } | { ok: false; error: string } {
  if (!callerId) return { ok: false, error: "Sign in is required." };
  if (turningOff && ownerId && ownerId !== callerId) {
    return { ok: false, error: "Only the owner who set the stop can clear it." };
  }
  return { ok: true };
}
