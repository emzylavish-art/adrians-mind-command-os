export type WorkerFile = {
  running?: boolean;
  heartbeatAt?: string;
  mode?: string;
  hosted?: boolean;
  owners?: number;
  ran?: number;
  failed?: number;
};

export function interpretWorkerHealth(file: WorkerFile | null, nowMs: number, staleMs: number) {
  const base = { localOnly: true, hosted: false };
  if (!file || file.running !== true || typeof file.heartbeatAt !== "string") {
    return { ...base, state: "offline" as const, detail: "No worker process is running. Schedules stay saved. Nothing is running in the background." };
  }
  const age = nowMs - Date.parse(file.heartbeatAt);
  if (!Number.isFinite(age) || age > staleMs) {
    return { ...base, state: "offline" as const, detail: "The last heartbeat is stale. The worker is not running." };
  }
  return { ...base, state: "local" as const, detail: "A local worker is polling this machine. It is not a hosted worker." };
}
