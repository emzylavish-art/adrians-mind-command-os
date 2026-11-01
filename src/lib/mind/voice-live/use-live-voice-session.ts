/**
 * React hook wrapping LiveVoiceSession for the persistent live-voice bar.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createVoiceClientSecret } from "../server.ts";
import { getVoiceMode, subscribeVoiceMode } from "../voice/mode-store.ts";
import { readStoredVoiceChoice } from "../voice/voices.ts";
import { formatVoiceClientError } from "../voice/errors.ts";
import { LiveVoiceSession, type LiveSessionDeps, type MintSecretResult } from "./live-session.ts";
import { phaseToLabel, phaseToUiAttr, type LiveVoicePublicState } from "./types.ts";
import { isLiveVoiceOccupied } from "./occupancy.ts";
import { readStoredVolume } from "./speaker-gain.ts";

const OFF_STATE: LiveVoicePublicState = {
  phase: "off",
  uiAttr: "off",
  label: "Off",
  level: 0,
  muted: false,
  error: null,
  active: false,
  modeBadge: "Direct",
};

export type UseLiveVoiceSessionOptions = {
  isOverlayMicOpen?: () => boolean;
  onUserTranscript?: (text: string) => void;
  onAssistantTranscript?: (text: string) => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
  mintSecret?: LiveSessionDeps["mintSecret"];
};

export function useLiveVoiceSession(options: UseLiveVoiceSessionOptions = {}) {
  const [state, setState] = useState<LiveVoicePublicState>(OFF_STATE);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [volume, setVolume] = useState(() =>
    readStoredVolume(typeof localStorage === "undefined" ? null : localStorage),
  );
  const sessionRef = useRef<LiveVoiceSession | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const ensureSession = useCallback(() => {
    if (sessionRef.current) return sessionRef.current;
    const mint: LiveSessionDeps["mintSecret"] =
      optionsRef.current.mintSecret ??
      (async (signal?: AbortSignal): Promise<MintSecretResult> => {
        try {
          if (signal?.aborted) return { ok: false, error: "Voice start canceled." };
          const secret = await createVoiceClientSecret();
          if (signal?.aborted) return { ok: false, error: "Voice start canceled." };
          if (!secret || typeof secret !== "object" || !("ok" in secret)) {
            return { ok: false, error: formatVoiceClientError(secret) };
          }
          if (!secret.ok) return { ok: false, error: formatVoiceClientError(secret) };
          return { ok: true, value: secret.value, expiresAt: secret.expiresAt ?? 0 };
        } catch (caught) {
          return { ok: false, error: formatVoiceClientError(caught) };
        }
      });

    const session = new LiveVoiceSession(
      {
        onState: (next) => setState(next),
        onUserTranscript: (text) => optionsRef.current.onUserTranscript?.(text),
        onAssistantTranscript: (text) => optionsRef.current.onAssistantTranscript?.(text),
        onError: (message) => optionsRef.current.onError?.(message),
        onNotice: (message) => optionsRef.current.onNotice?.(message),
      },
      {
        mintSecret: mint,
        isOverlayMicOpen: () => optionsRef.current.isOverlayMicOpen?.() ?? false,
        getMode: () => getVoiceMode(),
        getVoiceId: () =>
          readStoredVoiceChoice(typeof localStorage === "undefined" ? null : localStorage),
      },
    );
    sessionRef.current = session;
    return session;
  }, []);

  const pressMic = useCallback(() => {
    void ensureSession().pressMic();
  }, [ensureSession]);

  /** @deprecated alias — first tap starts, later taps mute */
  const toggle = pressMic;

  const start = useCallback(() => {
    void ensureSession().start();
  }, [ensureSession]);

  const end = useCallback(() => {
    sessionRef.current?.end("Live voice ended.");
    setSpeakerMuted(false);
    setState((prev) => ({ ...OFF_STATE, modeBadge: prev.modeBadge, error: null }));
  }, []);

  const toggleMute = useCallback(() => {
    ensureSession().toggleMute();
  }, [ensureSession]);

  const toggleSpeaker = useCallback(() => {
    const session = ensureSession();
    const next = session.speaker.toggleMute();
    setSpeakerMuted(next);
  }, [ensureSession]);

  const setOutputVolume = useCallback(
    (v: number) => {
      const session = ensureSession();
      const applied = session.speaker.setVolume(
        v,
        typeof localStorage === "undefined" ? null : localStorage,
      );
      setVolume(applied);
    },
    [ensureSession],
  );

  const sendText = useCallback(
    (text: string) => {
      const session = ensureSession();
      if (!session.isActive) return false;
      return session.sendText(text);
    },
    [ensureSession],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!sessionRef.current?.isActive && !isLiveVoiceOccupied()) return;
      // Settings / any modal open → do not end the call (popover owns Esc).
      if (document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"], [aria-modal="true"], dialog')) return;
      event.preventDefault();
      end();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [end]);

  // Keep live routing + badge in sync with header toggles (including rapid fire).
  useEffect(() => {
    return subscribeVoiceMode(() => {
      sessionRef.current?.notifyModeChange();
    });
  }, []);

    useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden" && isLiveVoiceOccupied()) {
        sessionRef.current?.end();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      sessionRef.current?.end();
      sessionRef.current = null;
    };
  }, []);

  return {
    state,
    uiAttr: state.uiAttr || phaseToUiAttr(state.phase, state.muted),
    label: state.label || phaseToLabel(state.phase, state.muted),
    level: state.level,
    muted: state.muted,
    speakerMuted,
    volume,
    active: state.active || isLiveVoiceOccupied(),
    error: state.error,
    modeBadge: state.modeBadge,
    pressMic,
    toggle,
    start,
    end,
    toggleMute,
    toggleSpeaker,
    setOutputVolume,
    sendText,
    sessionRef,
    lastTranscript: () => sessionRef.current?.lastTranscript ?? "",
  };
}
