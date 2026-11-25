import { useEffect, useRef, useState } from "react";
import { TALKING_HEAD_AVATAR, TALKING_HEAD_SOURCE, talkingHeadView } from "@/lib/mind/talking-head-face";

import type { TalkingHead } from "talkinghead";

export function TalkingHeadFace({ framing = "upper" }: { framing?: string }) {
  const node = useRef<HTMLDivElement>(null);
  const head = useRef<TalkingHead | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [note, setNote] = useState("Loading the open-source face.");
  const view = talkingHeadView(framing);

  const latestView = useRef(view);
  useEffect(() => {
    latestView.current = view;
    head.current?.setView(view);
  }, [view]);

  useEffect(() => {
    const mount = node.current;
    if (!mount) return;
    let stopped = false;
    function release() {
      const instance = head.current;
      head.current = null;
      const audio = instance?.audioCtx;
      try { instance?.dispose(); } finally {
        if (audio?.state !== "closed") void audio?.close().catch(() => undefined);
        mount?.replaceChildren();
      }
    }
    void (async () => {
      try {
        const { TalkingHead } = await import("talkinghead");
        if (stopped) return;
        const instance = new TalkingHead(mount, {
          lipsyncModules: [],
          cameraView: latestView.current,
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
        if (!stopped) {
          instance.setView(latestView.current);
          setState("ready");
          setNote("EVE’s 3D avatar");
        }
      } catch {
        if (!stopped) {
          release();
          setState("failed");
          setNote("3D avatar unavailable. You can still ask EVE or open Speak.");
        }
      }
    })();
    return () => {
      stopped = true;
      release();
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col" data-testid="talking-head-fallback" data-state={state} data-source={TALKING_HEAD_SOURCE}>
      <div hidden={state === "failed"} ref={node} data-testid="talking-head-stage" style={{ width: "100%", height: "100%", minHeight: "16rem" }} />
      <p className="p-3 text-xs text-muted" data-testid="talking-head-note">{note}</p>
    </div>
  );
}
