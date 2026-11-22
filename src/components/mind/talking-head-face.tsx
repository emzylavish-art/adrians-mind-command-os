import { useEffect, useRef, useState } from "react";
import { TALKING_HEAD_AVATAR, TALKING_HEAD_SOURCE, talkingHeadView } from "@/lib/mind/talking-head-face";

type TalkingHeadInstance = {
  showAvatar: (avatar: Record<string, unknown>) => Promise<void>;
  setView: (view: string) => void;
  stop: () => void;
  renderer?: { dispose: () => void; domElement?: HTMLCanvasElement };
  audioCtx?: { close?: () => Promise<void> | void };
};

export function TalkingHeadFace({ framing = "upper" }: { framing?: string }) {
  const node = useRef<HTMLDivElement>(null);
  const head = useRef<TalkingHeadInstance | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [note, setNote] = useState("Loading the open-source face.");
  const view = talkingHeadView(framing);

  useEffect(() => {
    head.current?.setView(view);
  }, [view]);

  useEffect(() => {
    const mount = node.current;
    if (!mount) return;
    let stopped = false;
    void (async () => {
      try {
        const spec = "talkinghead";
        const mod = await import(/* @vite-ignore */ spec) as { TalkingHead: new (node: HTMLElement, options?: Record<string, unknown>) => TalkingHeadInstance };
        if (stopped) return;
        const instance = new mod.TalkingHead(mount, {
          lipsyncModules: [],
          cameraView: view,
          cameraRotateEnable: false,
          cameraZoomEnable: false,
          cameraPanEnable: false,
          avatarMute: true,
          modelPixelRatio: 1,
          modelFPS: 15,
          ttsEndpoint: "",
          ttsApikey: null,
        });
        head.current = instance;
        await instance.showAvatar({
          url: TALKING_HEAD_AVATAR,
          body: "F",
          avatarMood: "neutral",
        });
        instance.setView(talkingHeadView(framing));
        if (!stopped) {
          setState("ready");
          setNote("Open-source TalkingHead is the face while Emma is reserved. This is the project sample, not a new generated person.");
        }
      } catch (error) {
        if (!stopped) {
          setState("failed");
          const message = error instanceof Error ? error.message : "The open-source face did not start.";
          setNote(message.includes("nk_") ? "The open-source face did not start." : message);
        }
      }
    })();
    return () => {
      stopped = true;
      const current = head.current;
      head.current = null;
      try { current?.stop(); } catch { /* already stopped */ }
      try { current?.renderer?.dispose(); } catch { /* renderer already gone */ }
      void current?.audioCtx?.close?.();
      mount.replaceChildren();
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col" data-testid="talking-head-fallback" data-state={state} data-source={TALKING_HEAD_SOURCE}>
      <div ref={node} data-testid="talking-head-stage" style={{ width: "100%", height: "100%", minHeight: "16rem" }} />
      <p className="px-3 pb-3 text-xs text-muted" data-testid="talking-head-note">{note}</p>
    </div>
  );
}
