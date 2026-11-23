export const HEARTBEAT_MS = 30000;
export const MISSED_HEARTBEATS = 2;
export const SURVIVABLE = ["email-queue", "message-triage"];

export function freshHandoff() {
  return {
    owner: "pc",
    flippedAt: null,
    inFlight: null,
    phoneDown: false,
    phone: "idle",
    sends: [],
  };
}

export function beat(now, peer, lastSeen) {
  return { peer, at: now, lastSeen };
}

export function missed(now, lastSeen) {
  if (!Number.isInteger(lastSeen)) return true;
  return now - lastSeen >= HEARTBEAT_MS * MISSED_HEARTBEATS;
}

export function pcObservePhone(state, now, phoneLastSeen) {
  const phoneDown = missed(now, phoneLastSeen);
  return { ...state, owner: "pc", phoneDown, phone: phoneDown ? "down" : "idle", note: phoneDown ? "Phone is down. PC stays primary." : "Phone is idle." };
}

export function phoneObservePc(state, now, pcLastSeen) {
  if (!missed(now, pcLastSeen)) {
    if (state.owner === "phone" && state.inFlight) return { ...state, phone: "handoff-pending", note: "PC is back. In-flight work stays with the phone until reclaim." };
    return { ...state, owner: "pc", phone: "idle", note: "PC is primary." };
  }
  return { ...state, owner: "phone", phone: "promoted", flippedAt: state.flippedAt ?? now, note: "PC heartbeat missed twice. Phone takes the survivable subset." };
}

export function claimTask(state, task) {
  if (!SURVIVABLE.includes(task.kind)) return { refused: "That task is not phone-survivable." };
  if (state.inFlight) return { refused: "A task is already in flight." };
  return { ...state, inFlight: { id: task.id, kind: task.kind, owner: state.owner } };
}

export function reclaim(state, now) {
  if (state.owner !== "phone" && !state.inFlight) return { ...state, owner: "pc", phone: "idle", flippedAt: now };
  if (state.inFlight && state.inFlight.owner === "phone") return { ...state, phone: "handoff-pending", note: "PC cannot reclaim until the phone finishes or writes the handoff." };
  return { ...state, owner: "pc", phone: "idle", inFlight: null, flippedAt: now };
}

export function finishInFlight(state) {
  if (!state.inFlight) return { refused: "Nothing is in flight." };
  return { ...state, inFlight: null };
}

export function beforeSharedSend(state, actor, id) {
  if (state.owner !== actor) return { refused: "Read the handoff first. This machine does not own shared messages." };
  if (state.sends.includes(id)) return { refused: "That send already happened." };
  return { ...state, sends: [...state.sends, id] };
}

export function wakeSignal() {
  return { pipe: "telegram-notification-only", executes: false, relay: "push", phoneIsServer: false };
}

export function irreversibleAction(kind, approved) {
  if (approved !== true) return { refused: "That action waits in the review folder. It is not sent, deleted, deployed, or committed." };
  if (!["send", "delete", "deploy", "commit"].includes(kind)) return { refused: "That action is not an approved shared action." };
  return { review: true, kind };
}
