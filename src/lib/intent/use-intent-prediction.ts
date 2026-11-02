import { useCallback, useEffect, useRef, useState } from "react";
import { recordIntentAcceptance } from "./frequency.ts";
import {
  createLocalStorageOutcomeReporter,
  getIntentOutcomeReporter,
  noopOutcomeReporter,
  reportIntentOutcome,
  setIntentOutcomeReporter,
} from "./outcome-reporter.ts";
import { rankIntents, topIntent } from "./ranker.ts";
import { runPredictedIntent, type IntentRunHandlers } from "./run.ts";
import {
  getLastIntentSource,
  pushComposerText,
  pushVoiceChunk,
  subscribeIntentSource,
} from "./source-bus.ts";
import type { IntentSource, RankedIntent } from "./types.ts";

export type UseIntentPredictionOptions = {
  /** External text override (e.g. controlled composer). When set, still ranks on every change. */
  text?: string;
  source?: IntentSource;
  handlers?: IntentRunHandlers;
  /** Debounce only the rendered top match (ranking stays sync). Default 40ms. */
  renderDebounceMs?: number;
  /** Install localStorage outcome reporter once (default true in browser). */
  useLocalOutcomeFallback?: boolean;
};

export type IntentPredictionState = {
  query: string;
  source: IntentSource;
  ranked: RankedIntent[];
  top: RankedIntent | null;
  /** Previous top while fading out after a wrong guess / replacement. */
  fading: RankedIntent | null;
  accept: () => void;
  rejectTop: () => void;
  pushText: (text: string) => void;
  pushVoice: (text: string) => void;
};

/**
 * Subscribe to composer keystrokes + voice chunks; rank every update; debounce chip render.
 */
export function useIntentPrediction(
  options: UseIntentPredictionOptions = {},
): IntentPredictionState {
  const handlersRef = useRef(options.handlers);
  handlersRef.current = options.handlers;
  const debounceMs = options.renderDebounceMs ?? 40;

  const [query, setQuery] = useState(() => options.text ?? getLastIntentSource().text);
  const [source, setSource] = useState<IntentSource>(
    () => options.source ?? getLastIntentSource().source,
  );
  const [ranked, setRanked] = useState<RankedIntent[]>([]);
  const [top, setTop] = useState<RankedIntent | null>(null);
  const [fading, setFading] = useState<RankedIntent | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRanked = useRef<RankedIntent[]>([]);
  const latestTop = useRef<RankedIntent | null>(null);

  useEffect(() => {
    if (options.useLocalOutcomeFallback === false) return;
    if (typeof localStorage === "undefined") return;
    // Only install fallback when still on noop (do not clobber a custom reporter).
    if (getIntentOutcomeReporter() !== noopOutcomeReporter) return;
    setIntentOutcomeReporter(createLocalStorageOutcomeReporter(localStorage));
  }, [options.useLocalOutcomeFallback]);

  const applyRanked = useCallback((nextQuery: string, nextSource: IntentSource) => {
    const next = rankIntents(nextQuery, { limit: 5 });
    latestRanked.current = next;
    const nextTop = next[0] ?? null;
    // Ranking is immediate for callers that read latest via accept(); UI below is debounced.
    if (renderTimer.current) clearTimeout(renderTimer.current);
    renderTimer.current = setTimeout(() => {
      setRanked(next);
      setTop((prev) => {
        if (prev && nextTop && prev.id !== nextTop.id) {
          setFading(prev);
          if (fadeTimer.current) clearTimeout(fadeTimer.current);
          fadeTimer.current = setTimeout(() => setFading(null), 160);
        } else if (prev && !nextTop) {
          setFading(prev);
          if (fadeTimer.current) clearTimeout(fadeTimer.current);
          fadeTimer.current = setTimeout(() => setFading(null), 160);
        }
        latestTop.current = nextTop;
        return nextTop;
      });
      setQuery(nextQuery);
      setSource(nextSource);
    }, debounceMs);
  }, [debounceMs]);

  useEffect(() => {
    return subscribeIntentSource((event) => {
      applyRanked(event.text, event.source);
    });
  }, [applyRanked]);

  useEffect(() => {
    if (options.text === undefined) return;
    applyRanked(options.text, options.source ?? "keystroke");
  }, [options.text, options.source, applyRanked]);

  useEffect(() => {
    return () => {
      if (renderTimer.current) clearTimeout(renderTimer.current);
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, []);

  const accept = useCallback(() => {
    const current = latestTop.current ?? topIntent(getLastIntentSource().text);
    if (!current) return;
    recordIntentAcceptance(current.id);
    reportIntentOutcome({
      intentId: current.id,
      accepted: true,
      source,
      query,
      score: current.score,
      at: Date.now(),
    });
    runPredictedIntent(current, handlersRef.current ?? {});
    setFading(null);
    setTop(null);
    latestTop.current = null;
  }, [query, source]);

  const rejectTop = useCallback(() => {
    const current = latestTop.current;
    if (!current) return;
    reportIntentOutcome({
      intentId: current.id,
      accepted: false,
      source,
      query,
      score: current.score,
      at: Date.now(),
    });
    setFading(current);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => setFading(null), 160);
    setTop(null);
    latestTop.current = null;
  }, [query, source]);

  return {
    query,
    source,
    ranked,
    top,
    fading,
    accept,
    rejectTop,
    pushText: pushComposerText,
    pushVoice: pushVoiceChunk,
  };
}
