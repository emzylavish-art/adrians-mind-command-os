import { useEffect, useId, useRef } from "react";
import {
  useIntentPrediction,
  type IntentRunHandlers,
  type RankedIntent,
} from "@/lib/intent";
import "./intent-prediction-chip.css";

type Props = {
  handlers?: IntentRunHandlers;
  className?: string;
  /** Optional controlled text (dashboard can pass shared ask/draft). */
  text?: string;
  source?: "keystroke" | "voice";
};

/**
 * Live top-match chip. Accept with click / Enter / Tab. Wrong guesses fade (~150ms), no toast.
 */
export function IntentPredictionChip(props: Props) {
  const { top, fading, accept, rejectTop } = useIntentPrediction({
    handlers: props.handlers,
    text: props.text,
    source: props.source,
  });
  const labelId = useId();
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!top) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inField = tag === "input" || tag === "textarea" || target?.isContentEditable;
      // Tab/Enter accept when chip focused, or Tab from composer when chip visible.
      if (event.key === "Escape" && (document.activeElement === btnRef.current || inField)) {
        // Silent reject — fade only.
        event.stopPropagation();
        rejectTop();
        return;
      }
      if (document.activeElement !== btnRef.current) return;
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        accept();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [top, accept, rejectTop]);

  if (!top && !fading) return null;

  return (
    <div
      className={`intent-predict ${props.className ?? ""}`}
      data-testid="intent-prediction"
      role="status"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {fading ? <ChipGhost intent={fading} /> : null}
      {top ? (
        <button
          ref={btnRef}
          type="button"
          id={labelId}
          className="intent-predict__chip"
          data-testid="intent-prediction-chip"
          aria-label={`Predicted intent: ${top.label}. Activate to run.`}
          title={`${top.label} · ${Math.round(top.score * 100)}%`}
          onClick={() => accept()}
        >
          <span className="intent-predict__kicker">Top match</span>
          <span className="intent-predict__label">{top.label}</span>
          <span className="intent-predict__hint" aria-hidden="true">
            Tab
          </span>
        </button>
      ) : null}
    </div>
  );
}

function ChipGhost(props: { intent: RankedIntent }) {
  return (
    <span className="intent-predict__chip is-fading" aria-hidden="true" data-testid="intent-prediction-fade">
      <span className="intent-predict__kicker">Top match</span>
      <span className="intent-predict__label">{props.intent.label}</span>
    </span>
  );
}
