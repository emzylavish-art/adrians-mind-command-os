export type BuildRuntime = {
  id: string;
  label: string;
  kind: "account" | "hosted" | "paired";
  files: boolean;
  coding: boolean;
  git: boolean;
  checkpoints: boolean;
  debugger: boolean;
  shell: boolean;
  detail: string;
};
export function buildRuntimeCapabilities(owner: string, agents: { id: string; label: string; fileProtocol?: number; capabilities?: { fileProtocol: number; codingRuntime: boolean; shell: boolean; busy: boolean } }[]): BuildRuntime[] {
  const hosted = owner === "dev-user";
  return [{ id: "hosted", label: hosted ? "Local hosted workspace" : "Account files", kind: hosted ? "hosted" : "account",
    files: true, coding: hosted, git: hosted, checkpoints: hosted, debugger: hosted, shell: hosted,
    detail: hosted ? "Local execution is available; no production result is implied." : "Read, edit and search account files. Choose an online computer for coding or terminal execution. Git and checkpoints require the local hosted runtime." },
    ...agents.map((agent): BuildRuntime => ({ id: agent.id, label: agent.label, kind: "paired", files: (agent.capabilities?.fileProtocol ?? agent.fileProtocol) === 2 && agent.capabilities?.busy !== true,
      coding: agent.capabilities?.codingRuntime === true && !agent.capabilities.busy,
      shell: agent.capabilities?.shell === true && !agent.capabilities.busy,
      git: false, checkpoints: false, debugger: false,
      detail: agent.capabilities ? "Capabilities reported by this online computer. Actual task results remain independently verified." : "Capability manifest unavailable. Reconnect an updated companion before executing tasks." }))];
}

export function checkpointListOutcome(httpOk: boolean, data: { ok?: boolean; checkpoints?: string[]; error?: string }) {
  if (!httpOk || data.ok !== true) return { ok: false as const, error: data.error || "Checkpoint listing failed. Retry after checking the selected runtime." };
  if (!Array.isArray(data.checkpoints) || data.checkpoints.some((item) => typeof item !== "string" || !item)) return { ok: false as const, error: "Checkpoint listing returned an unreadable result." };
  return { ok: true as const, latest: data.checkpoints[0] ?? null };
}
