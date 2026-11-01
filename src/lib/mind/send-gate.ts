/** Client-side send gate. Server haltIsOn remains authoritative. */

export function canSend(input: { halted: boolean; busy: boolean }): { ok: true } | { ok: false; reason: string } {
  if (input.halted) return { ok: false, reason: "Emergency stop is on. Sending and approvals are blocked." };
  if (input.busy) return { ok: false, reason: "A reply is already in progress." };
  return { ok: true };
}
