declare module "talkinghead" {
  export class TalkingHead {
    constructor(node: HTMLElement, options?: Record<string, unknown>);
    showAvatar(avatar: Record<string, unknown>): Promise<void>;
    setView(view: string): void;
    stop(): void;
    dispose(): void;
    renderer?: { dispose: () => void; domElement?: HTMLCanvasElement };
    audioCtx?: AudioContext;
  }
}
