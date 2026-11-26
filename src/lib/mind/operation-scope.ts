/** In-memory authority for callbacks. Never persisted; a new login starts a new epoch. */
export type OperationTicket = { id: number; epoch: number; kind: string; owner: string | null };
export function createOperationScope() {
  let owner: string | null = null;
  let session = "";
  let epoch = 0;
  let next = 0;
  const active = new Map<string, number>();
  return {
    bind(nextOwner: string | null, nextSession = "") {
      if (nextOwner !== owner || nextSession !== session) {
        owner = nextOwner; session = nextSession; epoch++; active.clear();
      }
    },
    begin(kind: string): OperationTicket {
      const ticket = { id: ++next, epoch, kind, owner };
      active.set(kind, ticket.id);
      return ticket;
    },
    current(ticket: OperationTicket): boolean {
      return ticket.owner === owner && ticket.epoch === epoch && active.get(ticket.kind) === ticket.id;
    },
    finish(ticket: OperationTicket): boolean {
      if (ticket.owner !== owner || ticket.epoch !== epoch || active.get(ticket.kind) !== ticket.id) return false;
      active.delete(ticket.kind);
      return true;
    },
    invalidate() { epoch++; active.clear(); },
  };
}
