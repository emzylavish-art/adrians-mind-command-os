export type LoopEvent = "start" | "pass" | "overlap" | "failure" | "shutdown";

export function createWorkerLoop(input: {
  runPass: () => Promise<unknown>;
  log: (event: LoopEvent, detail: string) => void;
}) {
  let stopped = false;
  let busy = false;
  let passes = 0;
  return {
    get stopped() {
      return stopped;
    },
    get busy() {
      return busy;
    },
    get passes() {
      return passes;
    },
    stop() {
      stopped = true;
      input.log("shutdown", "Stop requested. The current pass will finish. No new pass will start.");
    },
    async iteration() {
      if (stopped) return "stopped" as const;
      if (busy) {
        input.log("overlap", "A pass is already running. The extra pass was not started.");
        return "overlapped" as const;
      }
      busy = true;
      try {
        await input.runPass();
        passes += 1;
        input.log("pass", `Pass ${passes} finished.`);
        return "ran" as const;
      } catch (error) {
        input.log("failure", error instanceof Error ? error.message : "The pass failed.");
        return "failed" as const;
      } finally {
        busy = false;
      }
    },
  };
}
