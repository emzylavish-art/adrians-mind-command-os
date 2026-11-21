import { useEffect } from "react";
import { TalkingHeadFace } from "@/components/mind/talking-head-face";
import { noteSpokenText, setAvatarPresence } from "@/lib/mind/avatar/session";
import type { AvatarFraming } from "@/lib/mind/avatar/presence";
import type { EveProjection } from "@/lib/mind/eve-projection";

export function EveTurn({
  state,
  expression,
  spoken,
  framing = "upper",
  projection,
  className = "eve-stage-3d",
  showHead = false,
}: {
  state: "idle" | "listening" | "speaking";
  expression?: string | null;
  spoken?: string;
  framing?: AvatarFraming;
  projection?: EveProjection;
  className?: string;
  showHead?: boolean;
}) {
  useEffect(() => {
    if (state === "speaking" && spoken?.trim()) noteSpokenText(spoken);
    else if (expression === "speaking") noteSpokenText("I am here with you.");
    else setAvatarPresence(state === "listening" ? "listening" : "idle");
  }, [state, expression, spoken]);

  return (
    <div className={`${className} flex flex-col overflow-hidden`} data-testid="eve-turn" data-state={state} data-mood={expression || state} data-generated-figure="retired" role="img" aria-label="Emma's video is the face. The generated figure is not shown.">
      <p className="sr-only">{framing}{projection ? " projected" : ""}</p>
      {showHead ? <TalkingHeadFace framing={framing} /> : <p className="text-sm text-muted">The generated figure is not shown. The open-source face is in the face panel.</p>}
    </div>
  );
}
