import { hashBody, noteAgentAttempt, agentAttempts, redactSecrets, registerSource, callService, simulatePolicy, claimVerified } from "./frontier-2031.ts";

export type PackedTaskRecord = { id: string; goal: string; envelope: string };
export type SourceRecord = { id: string; path: string; licence: string; hash: string };
export type AttemptRecord = { agentId: string; attempted: string; ok: false; at: number };

export function rememberTask(id: string, goal: string, envelope: string): PackedTaskRecord {
  return { id, goal, envelope };
}

export function rememberSource(input: { id: string; path: string; licence: string; body: string }): SourceRecord {
  const saved = registerSource(input);
  return { id: saved.id, path: saved.path, licence: saved.licence, hash: saved.hash };
}

export function rememberAttempt(agentId: string, attempted: string): AttemptRecord {
  const note = noteAgentAttempt({ agentId, attempted, ok: false, at: Date.now() });
  return { agentId: note.agentId, attempted: note.attempted, ok: false, at: note.at };
}

export function attemptsFor(agentId: string): readonly AttemptRecord[] {
  return agentAttempts(agentId).map((note) => ({ agentId: note.agentId, attempted: note.attempted, ok: false, at: note.at }));
}

export function blueprintReply(text: string, state: {
  tasks: PackedTaskRecord[];
  sources: SourceRecord[];
  attempts: AttemptRecord[];
}): string | null {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  if (lower === "blueprint status") {
    return "Blueprint code is present. Identity network, bank, booking, marketplace, backup restore, headset, screen, and mouse finding are not verified. Nothing was purchased or called.";
  }
  if (lower === "list tasks") {
    return state.tasks.length ? state.tasks.map((task) => `${task.id}: ${task.goal}`).join("; ") : "No tasks are packed.";
  }
  if (lower === "list sources") {
    return state.sources.length ? state.sources.map((item) => `${item.id} ${item.licence} ${item.hash}`).join("; ") : "No sources are registered.";
  }
  const source = raw.match(/^register source\s+(\S+)\s+(\S+)\s+(.{1,80})$/i);
  if (source) {
    const saved = rememberSource({ id: `s${state.sources.length + 1}`, path: source[1], licence: source[2], body: source[3] });
    state.sources.push(saved);
    return `Source ${saved.id} recorded. Hash ${saved.hash}. The file was not opened.`;
  }
  const attempt = raw.match(/^note attempt\s+(\S+)\s+(.{1,160})$/i);
  if (attempt) {
    const saved = rememberAttempt(attempt[1], attempt[2].trim());
    state.attempts.push(saved);
    return `Attempt recorded for ${saved.agentId}. It was not executed.`;
  }
  const listed = raw.match(/^list attempts\s+(\S+)$/i);
  if (listed) {
    const found = state.attempts.filter((item) => item.agentId === listed[1]);
    return found.length ? found.map((item) => item.attempted).join("; ") : "No attempts are recorded.";
  }
  if (lower.startsWith("privacy check ")) {
    return redactSecrets(raw.slice("privacy check ".length));
  }
  if (/\b(negotiate|invoice|refund|book|purchase|buy)\b/i.test(lower) && lower.startsWith("office ")) {
    const policy = simulatePolicy("procurement");
    const service = callService({ name: "office", inputs: ["request"], outputs: ["result"] });
    return `${policy.reason}. ${service.reason}`;
  }
  if (lower === "backup status") {
    return `${claimVerified("backup").reason} No restore ran.`;
  }
  if (lower === "hash check") return hashBody("adrian");
  return null;
}
