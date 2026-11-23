export const HEARTBEAT_MS = 30000;
export const MISSED_HEARTBEATS = 2;
export const LEASE_MS = 60000;
export const WATCHDOG_MS = 60000;
export const FLAP_COOLDOWN_MS = 90000;
export const PROTOCOL_VERSION = 1;
export const SURVIVABLE = ["email-queue", "message-triage", "critical-notification"];
export const TRANSPORT = "supabase";

export function freshHandoff(now = 0) {
  return {
    owner: "pc",
    epoch: 1,
    lease_expires: now + LEASE_MS,
    flapUntil: 0,
    paused: false,
    flippedAt: null,
    inFlight: null,
    phoneDown: false,
    phone: "idle",
    sends: [],
    events: [],
    goingDown: false,
  };
}

export function freshOwnership(now = 0) {
  return { owner: "pc", epoch: 1, lease_expires: now + LEASE_MS, flapUntil: 0, paused: false };
}

export function beat(now, peer, lastSeen) {
  return { peer, at: now, lastSeen, transport: TRANSPORT };
}

export function heartbeat(actor, now, serverNow, health, goingDown = false) {
  return {
    actor,
    at: now,
    serverNow,
    health,
    goingDown: Boolean(goingDown),
    transport: TRANSPORT,
    deviceToDevice: false,
  };
}

export function missed(now, lastSeen) {
  if (!Number.isInteger(lastSeen)) return true;
  return now - lastSeen >= HEARTBEAT_MS * MISSED_HEARTBEATS;
}

export function compareAndSet(row, expectedEpoch, next, now) {
  if (!row || row.epoch !== expectedEpoch) return { refused: "Ownership changed. Read the row again." };
  if (now < (row.flapUntil || 0) && next.owner && next.owner !== row.owner) return { refused: "Cooldown. Do not flap." };
  return { ...row, ...next, epoch: row.epoch + 1 };
}

export function renewLease(row, actor, now) {
  if (row.paused) return { stopped: true, refused: "The pause flag is on. Stop outbound." };
  if (row.owner !== actor) return { stopped: true, refused: "This machine does not own the lease. Stop outbound." };
  if (now > row.lease_expires) return { stopped: true, refused: "Lease expired. Stop outbound." };
  return compareAndSet(row, row.epoch, { lease_expires: now + LEASE_MS }, now);
}

export function watchdog(row, now, pcLast, phoneLast) {
  const pcMissed = missed(now, pcLast);
  const phoneMissed = missed(now, phoneLast);
  if (pcMissed && phoneMissed) return { alert: "dead-man", channel: "separate", row };
  if (row.goingDown || pcMissed) {
    if (row.owner !== "pc") return { alert: null, row };
    const flipped = compareAndSet(row, row.epoch, { owner: "phone", lease_expires: now + LEASE_MS, flapUntil: now + FLAP_COOLDOWN_MS }, now);
    if (flipped.refused) return { alert: null, row, refused: flipped.refused };
    return { alert: "phone-primary", row: { ...flipped, flippedAt: now, phone: "promoted" } };
  }
  return { alert: null, row };
}

export function pcObservePhone(state, now, phoneLastSeen) {
  const phoneDown = missed(now, phoneLastSeen);
  return { ...state, owner: "pc", phoneDown, phone: phoneDown ? "down" : "idle", note: phoneDown ? "Phone is down. PC stays primary." : "Phone is idle." };
}

export function phoneObservePc(state, now, pcLastSeen) {
  if (state.paused) return { ...state, note: "Paused. No promotion." };
  if (!missed(now, pcLastSeen) && !state.goingDown) {
    if (state.owner === "phone" && state.inFlight) return { ...state, phone: "handoff-pending", note: "PC is back. In-flight work stays with the phone until reclaim." };
    return { ...state, owner: "pc", phone: "idle", note: "PC is primary." };
  }
  return { ...state, owner: "phone", phone: "promoted", flippedAt: state.flippedAt ?? now, note: "PC heartbeat missed twice. Phone takes the survivable subset." };
}

export function freshTask(id, kind) {
  return {
    id,
    kind,
    state: "queued",
    claimed_by: null,
    epoch: 0,
    lease_expires: null,
    checkpoint: null,
    failover_safe: SURVIVABLE.includes(kind),
    protocol_version: PROTOCOL_VERSION,
    events: [],
  };
}

function logEvent(task, event) {
  return { ...task, events: [...task.events, event] };
}

export function claimTask(state, task) {
  const kind = task.kind;
  if (task.failover_safe === false || (kind && !SURVIVABLE.includes(kind))) return { refused: "That task is not phone-survivable." };
  if (state.paused) return { refused: "The pause flag is on." };
  if (state.inFlight) return { refused: "A task is already in flight." };
  const claimed = {
    ...freshTask(task.id, kind || "message-triage"),
    ...task,
    state: "claimed",
    claimed_by: state.owner,
    epoch: (task.epoch || 0) + 1,
    lease_expires: null,
    failover_safe: true,
  };
  return { ...state, inFlight: claimed };
}

export function reclaim(state, now) {
  if (state.owner !== "phone" && !state.inFlight) return { ...state, owner: "pc", phone: "idle", flippedAt: now };
  if (state.inFlight && (state.inFlight.owner === "phone" || state.inFlight.claimed_by === "phone")) {
    return { ...state, phone: "handoff-pending", note: "PC cannot reclaim until the phone finishes or writes the handoff." };
  }
  return { ...state, owner: "pc", phone: "idle", inFlight: null, flippedAt: now };
}

export function finishInFlight(state) {
  if (!state.inFlight) return { refused: "Nothing is in flight." };
  const done = logEvent({ ...state.inFlight, state: "finished" }, { type: "finished", id: state.inFlight.id });
  return { ...state, inFlight: null, events: [...(state.events || []), done.events.at(-1)] };
}

export function beforeSharedSend(state, actor, id) {
  if (state.paused) return { refused: "The pause flag is on." };
  if (state.owner !== actor) return { refused: "Read the handoff first. This machine does not own shared messages." };
  if (state.sends.includes(id)) return { refused: "That send already happened." };
  return { ...state, sends: [...state.sends, id] };
}

export function wakeSignal() {
  return { pipe: "telegram-human-notice", executes: false, deviceToDevice: false, relay: "supabase", phoneIsServer: false };
}

export function telegramNotice(userId, allowedId, text) {
  if (userId !== allowedId) return { refused: "That Telegram user is not on the allowlist." };
  return { pipe: "human-notice", executes: false, deviceToDevice: false, approvalButton: true, text };
}

export function irreversibleAction(kind, approved) {
  if (approved !== true) return { refused: "That action waits in the review folder. It is not sent, deleted, deployed, or committed." };
  if (!["send", "delete", "deploy", "commit"].includes(kind)) return { refused: "That action is not an approved shared action." };
  return { review: true, kind, executes: false };
}

export function modelProposal(text) {
  return { kind: "proposal", executes: false, text };
}

export function emailScope() {
  return { read: true, draft: true, send: false };
}

export function statusView(row, now, pcLast, phoneLast) {
  return {
    primary: row.owner,
    epoch: row.epoch,
    lease_expires: row.lease_expires,
    paused: row.paused,
    pcLast,
    phoneLast,
    pcMissed: missed(now, pcLast),
    phoneMissed: missed(now, phoneLast),
    measuredFailoverMs: null,
    iosBackgroundWakeAssumed: false,
  };
}
