/** Shared ownership/operation contract. Platform adapters supply storage and transport. */
export type ClientSurface = "web" | "windows" | "ios" | "android";
export type OwnedClientOperation = { id: string; ownerId: string; workspaceId: string; baseRevision: number; kind: "conversation.append" | "workspace.update"; payload: Record<string, unknown>; dispatchState?: "pending" | "sending" | "needs-review" };
export type ClientReceipt = { id: string; ownerId: string; workspaceId: string; revision: number; state: "applied" | "conflict" | "not_sent" | "unknown"; detail: string };
export type ClientAdapter = {
  surface: ClientSurface;
  currentOwner(): string | null;
  online(): boolean;
  authorizedWorkspace(owner: string, workspace: string): boolean | Promise<boolean>;
  loadQueue(owner: string): Promise<OwnedClientOperation[]>;
  saveQueue(owner: string, queue: OwnedClientOperation[]): Promise<void>;
  send(operation: OwnedClientOperation): Promise<ClientReceipt>;
};
export function clientPlatformAvailability(surface: ClientSurface) {
  return { surface, implementation: surface === "web" ? "implemented" : surface === "windows" ? "configured" : "unimplemented", lifecycleProof: "unverified", nativeDeviceProof: "unverified", responsiveLayoutIsNativeProof: false, sharedContractVersion: 1 };
}
export function createOwnedClientRuntime(adapter: ClientAdapter) {
  let flushing = false;
  async function enqueue(operation: OwnedClientOperation): Promise<ClientReceipt> {
    const stopped = (detail: string): ClientReceipt => ({ id: operation.id, ownerId: operation.ownerId, workspaceId: operation.workspaceId, revision: operation.baseRevision, state: "not_sent", detail });
    const owner = adapter.currentOwner();
    if (operation.dispatchState && operation.dispatchState !== "pending") return stopped("Only a new pending operation may be queued.");
    if (!owner || owner !== operation.ownerId || !operation.workspaceId || !operation.id || !["conversation.append", "workspace.update"].includes(operation.kind) || !Number.isSafeInteger(operation.baseRevision) || operation.baseRevision < 0 || !await adapter.authorizedWorkspace(owner, operation.workspaceId)) return stopped("Owner, workspace or operation revision could not be authorized.");
    if (adapter.currentOwner() !== owner) return stopped("The account changed before queue storage. Nothing was queued.");
    const queue = await adapter.loadQueue(owner);
    if (adapter.currentOwner() !== owner) return stopped("The account changed before queue storage. Nothing was queued.");
    const existing = queue.find(item => item.id === operation.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(operation)) return stopped("This operation ID already belongs to different arguments. Nothing was replaced.");
    if (!existing) await adapter.saveQueue(owner, [...queue, structuredClone(operation)]);
    return stopped("Saved in this account's queue. No remote action ran. Review and explicitly sync when connected.");
  }
  async function flush(): Promise<ClientReceipt[]> {
    const owner = adapter.currentOwner();
    if (flushing || !owner || !adapter.online()) return [];
    flushing = true;
    const receipts: ClientReceipt[] = [];
    try {
      const queue = await adapter.loadQueue(owner);
      for (const operation of queue) {
        if (operation.dispatchState === "sending" || operation.dispatchState === "needs-review") break;
        if (operation.ownerId !== owner || adapter.currentOwner() !== owner || !adapter.online() || !await adapter.authorizedWorkspace(owner, operation.workspaceId) || adapter.currentOwner() !== owner) break;
        // Durable claim precedes dispatch. A restart leaves a review-required operation, never a replay.
        const beforeSend = await adapter.loadQueue(owner);
        await adapter.saveQueue(owner, beforeSend.map(item => item.id === operation.id ? { ...item, dispatchState: "sending" } : item));
        if (adapter.currentOwner() !== owner || !adapter.online()) break;
        let receipt: ClientReceipt;
        try { receipt = await adapter.send(structuredClone(operation)); }
        catch { receipt = { id: operation.id, ownerId: owner, workspaceId: operation.workspaceId, revision: operation.baseRevision, state: "unknown", detail: "Transport stopped after dispatch. Reconcile this operation ID before retrying; no automatic replay." }; }
        if (!receipt || !["applied", "conflict", "not_sent", "unknown"].includes(receipt.state) || receipt.id !== operation.id || receipt.ownerId !== owner || receipt.workspaceId !== operation.workspaceId || !Number.isSafeInteger(receipt.revision) || receipt.revision < operation.baseRevision || (receipt.state === "applied" && receipt.revision === operation.baseRevision)) receipt = { id: operation.id, ownerId: owner, workspaceId: operation.workspaceId, revision: operation.baseRevision, state: "unknown", detail: "The receipt did not match the dispatched owner, workspace and operation." };
        receipts.push(receipt);
        if (receipt.state !== "applied") {
          const current = await adapter.loadQueue(owner);
          await adapter.saveQueue(owner, current.map(item => item.id === operation.id ? { ...item, dispatchState: "needs-review" } : item));
          break;
        }
        // Persist to the original owner's queue even if the UI has changed accounts.
        const current = await adapter.loadQueue(owner);
        await adapter.saveQueue(owner, current.filter(item => item.id !== operation.id));
      }
      return receipts;
    } finally { flushing = false; }
  }
  return { enqueue, flush, availability: clientPlatformAvailability(adapter.surface) };
}
