import type { SpeakEvent } from "./events.ts";

export type SpeakListener = (event: SpeakEvent) => void;

/** Small typed bus. The pipeline subscribes; speak state and the pipeline both publish. */
export class SpeakEventBus {
  private listeners = new Set<SpeakListener>();

  subscribe(listener: SpeakListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeTo<T extends SpeakEvent["type"]>(
    type: T,
    listener: (event: Extract<SpeakEvent, { type: T }>) => void,
  ): () => void {
    return this.subscribe((event) => {
      if (event.type === type) listener(event as Extract<SpeakEvent, { type: T }>);
    });
  }

  publish(event: SpeakEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
