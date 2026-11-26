export type BuildPlanningAttempt = { ownerId: string | undefined; controller: AbortController };

/** Shared cancellation boundary for planning; late provider results stay obsolete. */
export function createBuildPlanningGate() {
  let current: BuildPlanningAttempt | null = null;
  return {
    begin(ownerId: string | undefined, halted: boolean): BuildPlanningAttempt | null {
      if (halted || current) return null;
      current = { ownerId, controller: new AbortController() };
      return current;
    },
    isCurrent(attempt: BuildPlanningAttempt, ownerId: string | undefined, halted: boolean) {
      return current === attempt && ownerId === attempt.ownerId && !halted && !attempt.controller.signal.aborted;
    },
    stop() { current?.controller.abort(); current = null; },
    finish(attempt: BuildPlanningAttempt) {
      if (current !== attempt) return false;
      current = null;
      return true;
    },
  };
}
