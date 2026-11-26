import type { UsageReceipt } from "./usage-ledger.ts";

export type UsageRecorder = (ownerId: string, receipt: UsageReceipt) => Promise<void>;

/** Import durable storage only for a real authenticated observation. */
export const recordUsageObservation: UsageRecorder = async (ownerId, receipt) => {
  if (!ownerId.trim()) throw new Error("An owner is required for execution accounting.");
  const [{ getSql }, { writeUsageReceipt }] = await Promise.all([
    import("../db.ts"), import("./usage-ledger.server.ts"),
  ]);
  await writeUsageReceipt(await getSql(), ownerId, receipt);
};

/** ACP reports runtime progress, not provider identity, tokens, or billing. */
export function buildRuntimeUsage(input: {
  operationId: string; at: string;
  state?: UsageReceipt["executionState"];
  started: boolean;
}): UsageReceipt {
  return {
    id: `${input.operationId}/runtime`, operationId: input.operationId,
    stage: "runtime", channel: "build", chatId: "", at: input.at,
    executionState: input.state, dispatched: input.started,
    providerDispatch: input.started ? "unknown" : "not_sent",
    provider: "unknown", model: "unknown", requestId: null,
    promptTokens: null, completionTokens: null, outcome: "unconfirmed",
  };
}

export async function observeBuildRuntime<T>(input: {
  ownerId: string; operationId: string;
  run: () => Promise<T>; state: (result: T) => UsageReceipt["executionState"];
  record?: UsageRecorder;
}): Promise<T> {
  const at = new Date().toISOString();
  const save = (state: UsageReceipt["executionState"]) =>
    (input.record ?? recordUsageObservation)(input.ownerId, buildRuntimeUsage({ operationId: input.operationId, at, state, started: true })).catch(() => undefined);
  await save("running");
  try {
    const result = await input.run();
    await save(input.state(result));
    return result;
  } catch (error) {
    await save("failed");
    throw error;
  }
}
