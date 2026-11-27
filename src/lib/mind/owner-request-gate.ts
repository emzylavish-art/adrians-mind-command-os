/** A request may publish only to the mounted owner and the current generation. */
export class OwnerRequestGate {
  private generation = 0;
  active = true;
  readonly ownerId: string;
  constructor(ownerId: string) { this.ownerId = ownerId; }
  begin(ownerId: string): number {
    if (!this.active || ownerId !== this.ownerId) return -1;
    return ++this.generation;
  }
  accept(ticket: number, ownerId: string): boolean {
    return this.active && ticket > 0 && ticket === this.generation && ownerId === this.ownerId;
  }
  close(): void { this.active = false; ++this.generation; }
}
