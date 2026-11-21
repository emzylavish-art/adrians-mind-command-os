export const FIRST_STEPS_KEY = "amcos.first-steps.v1";

export const FIRST_STEPS = [
  {
    id: "ask",
    title: "Start here",
    body: "Type a question, then press Send.",
    image: "/brand/guides/ask.jpg",
    action: "Type a question",
  },
  {
    id: "speak",
    title: "Speak is a call",
    body: "The microphone is dictation. They stay separate.",
    image: "/brand/guides/speak.jpg",
    action: "Open Speak",
  },
  {
    id: "settings",
    title: "Open Settings",
    body: "Sign-in, keys, data, and safety live in groups.",
    image: "/brand/guides/settings.jpg",
    action: "Open Settings",
  },
  {
    id: "sign-in",
    title: "Sign in or sign up",
    body: "A new account starts empty. Your account keeps its own copy.",
    image: "/brand/guides/sign-in.jpg",
    action: "Open sign-in",
  },
] as const;

export type FirstStepId = (typeof FIRST_STEPS)[number]["id"];
export type FirstStepsState = { step: number; dismissed: boolean };

export function readFirstSteps(raw: string | null): FirstStepsState {
  if (!raw) return { step: 0, dismissed: false };
  try {
    const parsed = JSON.parse(raw) as { step?: unknown; dismissed?: unknown };
    const step = typeof parsed.step === "number" && Number.isInteger(parsed.step) ? parsed.step : 0;
    return {
      step: Math.min(Math.max(step, 0), FIRST_STEPS.length - 1),
      dismissed: parsed.dismissed === true,
    };
  } catch {
    return { step: 0, dismissed: false };
  }
}

export function nextFirstStep(state: FirstStepsState): FirstStepsState {
  if (state.step >= FIRST_STEPS.length - 1) return { step: state.step, dismissed: true };
  return { step: state.step + 1, dismissed: false };
}

export function previousFirstStep(state: FirstStepsState): FirstStepsState {
  return { step: Math.max(0, state.step - 1), dismissed: false };
}

export function dismissFirstSteps(state: FirstStepsState): FirstStepsState {
  return { step: state.step, dismissed: true };
}

export function reopenFirstSteps(): FirstStepsState {
  return { step: 0, dismissed: false };
}
