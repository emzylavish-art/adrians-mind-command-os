/** Keystroke / voice intent prediction types (client-only). */

export type IntentSource = "keystroke" | "voice";

export type IntentAction =
  | { type: "view"; view: string }
  | { type: "route"; href: string }
  | { type: "model"; tier: string }
  | { type: "open-model-picker" }
  | { type: "start-voice" }
  | { type: "open-palette" }
  | { type: "search-memory" };

export type CatalogIntent = {
  id: string;
  label: string;
  /** Extra tokens used for ranking (not shown). */
  aliases: string[];
  action: IntentAction;
};

export type RankedIntent = {
  id: string;
  label: string;
  score: number;
  action: IntentAction;
};

export type IntentOutcome = {
  intentId: string;
  accepted: boolean;
  source: IntentSource;
  query: string;
  score: number;
  at: number;
};

export type IntentOutcomeReporter = {
  report: (outcome: IntentOutcome) => void;
};
