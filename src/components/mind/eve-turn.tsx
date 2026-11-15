import { lazy, Suspense, useEffect } from "react";
import { noteSpokenText, setAvatarPresence } from "@/lib/mind/avatar/session";
import type { AvatarExpression, AvatarFraming } from "@/lib/mind/avatar/presence";
import type { EveProjection } from "@/lib/mind/eve-projection";

const HumanStage = lazy(() => import("@/components/mind/avatar/human-stage").then((module) => ({ default: module.HumanStage })));

const FACE = "/brand/eve-idle.jpg";

export function EveTurn({
  state,
  expression,
  spoken,
  framing = "upper",
  projection,
  className = "eve-stage-3d",
}: {
  state: "idle" | "listening" | "speaking";
  expression?: string | null;
  spoken?: string;
  framing?: AvatarFraming;
  projection?: EveProjection;
  className?: string;
}) {
  useEffect(() => {
    if (state === "speaking" && spoken?.trim()) noteSpokenText(spoken);
    else if (expression === "speaking") noteSpokenText("I am here with you.");
    else setAvatarPresence(state === "listening" ? "listening" : "idle");
  }, [state, expression, spoken]);

  return (
    <div className={className} data-testid="eve-turn" data-state={state} data-mood={expression || state} aria-label="EVE, an AI person. Drag to turn her.">
      <Suspense fallback={null}>
        <HumanStage characterId="eve" framing={framing} expression={expression as AvatarExpression | null} faceSrc={FACE} projection={projection} onFail={() => undefined} />
      </Suspense>
    </div>
  );
}
