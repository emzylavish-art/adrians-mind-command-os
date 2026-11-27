import { randomUUID } from "node:crypto";

type Authorize = (owner: string, provider: string, model: string, taskId: string, free: boolean, unknownTokens: boolean) => Promise<(ok: boolean, requestId?: string) => Promise<void>>;
export type HostedResourceReceipt = {
  taskId: string;
  provider: "hosted-acp";
  model: "runtime-selected";
  cost: "unknown";
  scope: "One coding turn; internal model calls and token usage are not metered by Mind OS.";
};

/** The external runtime selects its model and can make several calls. Never price it as a free token call. */
export async function runGovernedHostedCoding<T>(
  owner: string,
  run: () => Promise<T>,
  accepted: (result: T) => boolean,
  options: { taskId?: string; authorize?: Authorize } = {},
): Promise<{ result: T; resourceReceipt: HostedResourceReceipt }> {
  const taskId = options.taskId || randomUUID();
  const authorize = options.authorize || (await import("../../external-resource-call.server.ts")).authorizeExternalResource;
  // authorizeExternalResource deliberately reserves unknownCost=true for this non-free process.
  const settle = await authorize(owner, "hosted-acp", "runtime-selected", taskId, false, true);
  try {
    const result = await run();
    await settle(accepted(result));
    return { result, resourceReceipt: { taskId, provider: "hosted-acp", model: "runtime-selected", cost: "unknown", scope: "One coding turn; internal model calls and token usage are not metered by Mind OS." } };
  } catch (error) {
    await settle(false);
    throw error;
  }
}
