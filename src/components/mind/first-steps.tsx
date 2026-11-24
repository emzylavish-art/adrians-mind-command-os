import {
  dismissFirstSteps,
  FIRST_STEPS,
  nextFirstStep,
  previousFirstStep,
  type FirstStepId,
  type FirstStepsState,
} from "@/lib/mind/first-steps";

function liftGuide(node: HTMLElement | null) {
  if (!node) return;
  const light = document.documentElement.dataset.theme === "light";
  const narrow = window.matchMedia("(max-width: 767px)").matches || node.getBoundingClientRect().width < 560;
  node.style.setProperty("position", "relative", "important");
  node.style.setProperty("display", "flex", "important");
  node.style.setProperty("flex-wrap", narrow ? "nowrap" : "wrap", "important");
  node.style.setProperty("align-items", "center", "important");
  node.style.setProperty("gap", "12px", "important");
  node.style.setProperty("width", "100%", "important");
  node.style.setProperty("max-width", "100%", "important");
  node.style.setProperty("box-sizing", "border-box", "important");
  node.style.setProperty("overflow", "hidden", "important");
  node.style.setProperty("border-radius", "22px", "important");
  node.style.setProperty("background-color", light ? "#f4f4f5" : "#1c1c1e", "important");
  node.style.setProperty("color", light ? "#18181b" : "#fafafa", "important");
  node.style.setProperty("border", light ? "1px solid rgba(0,0,0,0.08)" : "1px solid rgba(255,255,255,0.12)", "important");
  node.style.setProperty("box-shadow", light ? "inset 0 1px 0 #fff, 0 18px 40px rgba(15, 23, 42, 0.16)" : "inset 0 1px 0 rgba(255,255,255,0.14), 0 18px 40px rgba(0,0,0,0.45)", "important");
  node.style.setProperty("padding", "12px", "important");
  const image = node.querySelector("img");
  if (image instanceof HTMLElement) {
    image.style.setProperty("width", narrow ? "72px" : "min(220px, 34%)", "important");
    image.style.setProperty("height", narrow ? "52px" : "96px", "important");
    image.style.setProperty("flex", "0 0 auto", "important");
    image.style.setProperty("object-fit", "cover", "important");
  }
  node.querySelectorAll("div, figcaption").forEach((child) => {
    if (!(child instanceof HTMLElement) || child.parentElement !== node) return;
    child.style.setProperty("min-width", "0", "important");
    child.style.setProperty("flex", "1 1 auto", "important");
  });
}

function guideImage(src: string, hidden: boolean, onError: () => void, tall = false) {
  if (hidden) return null;
  return (
    <img
      src={src}
      alt=""
      width={640}
      height={360}
      style={{ width: tall ? "100%" : "min(220px, 100%)", height: tall ? "112px" : "96px", objectFit: "cover", borderRadius: "14px", display: "block", flex: "0 0 auto" }}
      onError={onError}
    />
  );
}

export function FirstSteps({
  state,
  onChange,
  onOpen,
}: {
  state: FirstStepsState;
  onChange: (next: FirstStepsState) => void;
  onOpen: (id: FirstStepId) => void;
}) {
  if (state.dismissed) return null;
  const step = FIRST_STEPS[state.step] ?? FIRST_STEPS[0];
  return (
    <section className="settings-card home-guide" data-testid="first-steps" aria-label="Next step">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted">Step {state.step + 1} of {FIRST_STEPS.length}</p>
        <h2 className="font-display text-xl font-bold" data-testid="first-steps-title">{step.title}</h2>
        <p data-testid="first-steps-body">{step.body}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="min-h-11 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink" data-testid="first-steps-open" onClick={() => onOpen(step.id)}>
            {step.action}
          </button>
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" data-testid="first-steps-back" disabled={state.step === 0} onClick={() => onChange(previousFirstStep(state))}>
            Back
          </button>
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" data-testid="first-steps-next" onClick={() => onChange(nextFirstStep(state))}>
            Next
          </button>
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" data-testid="first-steps-dismiss" onClick={() => onChange(dismissFirstSteps(state))}>
            Dismiss
          </button>
        </div>
      </div>
    </section>
  );
}

export function SignInGuide() {
  const step = FIRST_STEPS[3];
  return (
    <figure ref={liftGuide} className="settings-card mt-4" data-testid="login-guide">
      {guideImage(step.image, false, () => undefined)}
      <figcaption className="text-sm leading-relaxed" style={{ minWidth: 0, flex: "1 1 12rem" }}>
        <strong className="block">{step.title}</strong>
        <span>{step.body} Password reset email is not set up.</span>
      </figcaption>
    </figure>
  );
}
