/**
 * Outcome reporter interface for later pattern_outcomes Supabase wiring.
 * Default is no-op. LocalStorage fallback stores recent accept/reject rows client-side only —
 * never talks to Supabase from the browser.
 */
import type { IntentOutcome, IntentOutcomeReporter } from "./types.ts";

export const INTENT_OUTCOMES_KEY = "amcos.intent.outcomes.v1";
export const MAX_STORED_OUTCOMES = 200;

export const noopOutcomeReporter: IntentOutcomeReporter = {
  report() {
    /* intentional no-op — server pattern_outcomes can replace this later */
  },
};

type Store = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function readOutcomes(store: Store): IntentOutcome[] {
  try {
    const raw = store.getItem(INTENT_OUTCOMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as IntentOutcome[]) : [];
  } catch {
    return [];
  }
}

/**
 * Client fallback: append outcomes to localStorage for later sync.
 * Shape mirrors pattern_outcomes conceptually (hit = accepted).
 */
export function createLocalStorageOutcomeReporter(
  store: Store | null = typeof localStorage === "undefined" ? null : localStorage,
): IntentOutcomeReporter {
  if (!store) return noopOutcomeReporter;
  return {
    report(outcome: IntentOutcome) {
      try {
        const rows = readOutcomes(store);
        rows.push(outcome);
        while (rows.length > MAX_STORED_OUTCOMES) rows.shift();
        store.setItem(INTENT_OUTCOMES_KEY, JSON.stringify(rows));
      } catch {
        /* ignore */
      }
    },
  };
}

let activeReporter: IntentOutcomeReporter = noopOutcomeReporter;

export function setIntentOutcomeReporter(reporter: IntentOutcomeReporter | null | undefined): void {
  activeReporter = reporter ?? noopOutcomeReporter;
}

export function getIntentOutcomeReporter(): IntentOutcomeReporter {
  return activeReporter;
}

export function reportIntentOutcome(outcome: IntentOutcome): void {
  activeReporter.report(outcome);
}
