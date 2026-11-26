import { emptyWorkspace } from "./workspace.ts";
import type { Workspace } from "./types.ts";
import { normalizeSerializedWorkspace, type WorkspaceParseRequest, type WorkspaceParseResponse } from "./workspace-codec.ts";
export { normalizeSerializedWorkspace, handleWorkspaceParse, type WorkspaceParseRequest, type WorkspaceParseResponse } from "./workspace-codec.ts";

export type WorkspaceParserWorker = {
  postMessage(message: WorkspaceParseRequest): void;
  terminate(): void;
  onmessage: ((event: { data: WorkspaceParseResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export const yieldWorkspaceWork = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Full structured snapshot only. Cancellation and failures never return a partial or empty replacement. */
export async function parseWorkspaceDeferred(raw: string | null, options: { signal?: AbortSignal; createWorker?: (() => WorkspaceParserWorker) | null; yieldControl?: () => Promise<void>; timeoutMs?: number } = {}): Promise<{ workspace: Workspace; method: "worker" | "yielded-main-thread" | "empty" }> {
  const signal = options.signal;
  const abort = () => { if (signal?.aborted) throw new Error("Workspace loading was cancelled for the previous account."); };
  abort(); await (options.yieldControl ?? yieldWorkspaceWork)(); abort();
  if (raw === null || raw === "") return { workspace: emptyWorkspace(), method: "empty" };
  const factory = options.createWorker === undefined
    ? typeof Worker !== "undefined" ? () => new Worker(new URL("./workspace-load.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkspaceParserWorker : null
    : options.createWorker;
  if (factory) {
    let worker: WorkspaceParserWorker | null = null;
    try { worker = factory(); } catch { /* Restricted browsers use the explicit yielded fallback. */ }
    if (worker) {
      const ownedWorker = worker;
      const id = crypto.randomUUID();
      try {
        const workspace = await new Promise<Workspace>((resolve, reject) => {
          let done = false;
          const finish = (result: WorkspaceParseResponse | Error) => {
            if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener("abort", cancelled);
            if (result instanceof Error) reject(result); else if (!result.ok) reject(new Error(result.error)); else resolve(result.workspace);
          };
          const cancelled = () => finish(new Error("Workspace loading was cancelled for the previous account."));
          const timer = setTimeout(() => finish(new Error("Workspace loading timed out. The stored copy was kept. Reload to retry.")), options.timeoutMs ?? 30_000);
          ownedWorker.onmessage = (event) => { if (event.data.id === id) finish(event.data); };
          ownedWorker.onerror = () => finish(new Error("The workspace loader stopped. The stored copy was kept. Reload to retry."));
          signal?.addEventListener("abort", cancelled, { once: true });
          if (signal?.aborted) { cancelled(); return; }
          try { ownedWorker.postMessage({ id, raw }); } catch { finish(new Error("The workspace could not be sent to its loader. The stored copy was kept.")); }
        });
        abort(); return { workspace, method: "worker" };
      } finally { ownedWorker.onmessage = null; ownedWorker.onerror = null; ownedWorker.terminate(); }
    }
  }
  abort();
  return { workspace: normalizeSerializedWorkspace(raw), method: "yielded-main-thread" };
}
