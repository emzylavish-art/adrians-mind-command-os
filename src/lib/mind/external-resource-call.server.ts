import { reserveResourceOperation, settleResourceOperation } from "./resource-governor.server.ts";
import { haltIsOn } from "./halt.server.ts";
export type ResourceBlockedResult = { ok: false; code: "resource_policy"; error: string; status: 403; dispatched: false };
export class ResourceDispatchBlocked extends Error {
  constructor(message: string) { super(message); this.name = "ResourceDispatchBlocked"; }
}
export function resourceBlockedResult(error: unknown): ResourceBlockedResult {
  return { ok: false, code: "resource_policy", status: 403, dispatched: false,
    error: error instanceof ResourceDispatchBlocked ? error.message : "Resource authorization could not be verified. The provider was not contacted." };
}
/** Non-token providers have unpriced usage until an actual tariff/receipt adapter exists. */
export async function authorizeExternalResource(owner: string, provider: string, model: string, taskId: string = crypto.randomUUID(), free = false, unknownTokens = false) {
  if (await haltIsOn(owner)) throw new ResourceDispatchBlocked("Emergency stop is on or its state is unknown. The provider was not contacted.");
  let reservation;
  try { reservation = await reserveResourceOperation({ owner, provider, model, taskId, free, unknownCost: !free, unknownTokens, inputTokens: 0, outputTokens: 0 }); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new ResourceDispatchBlocked(/^(Account Free-only|Daily provider-call|Provider concurrency|Daily token|Token usage is unknown|Provider cost is unknown|Estimated request cost|Insufficient unreserved)/.test(message)
      ? `${message} The provider was not contacted.` : "Resource authorization could not be verified. The provider was not contacted.");
  }
  if (await haltIsOn(owner)) {
    await settleResourceOperation(reservation, { outcome: "not_dispatched" }).catch(() => {});
    throw new ResourceDispatchBlocked("Emergency stop changed before dispatch. The provider was not contacted.");
  }
  return async (ok: boolean, requestId?: string) => {
    await settleResourceOperation(reservation, { outcome: ok ? "succeeded" : "unknown", requestId }).catch(() => {});
  };
}
export async function externalResourceCall<T extends { ok: boolean }>(input: { owner: string; provider: string; model: string; taskId?: string; free?: boolean; unknownTokens?: boolean }, run: () => Promise<T>): Promise<T | ResourceBlockedResult> {
  let settle;
  try { settle = await authorizeExternalResource(input.owner, input.provider, input.model, input.taskId, input.free, input.unknownTokens); }
  catch (error) { return resourceBlockedResult(error); }
  try { const result = await run(); await settle(result.ok); return result; }
  catch (error) { await settle(false); throw error; }
}
