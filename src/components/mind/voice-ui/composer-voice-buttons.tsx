/**
 * Grok-like bottom composer chrome (presentational).
 *
 * MIC (dictation) ≠ SPEAK (live two-way). After Speak, LiveVoiceBar is the in-call UI.
 * Callbacks only — no audio / stream / session logic.
 *
 * Layout (anchored bottom):
 *   Row 1: Ask Anything field
 *   Row 2: [+] [model chip → menu UP] …… [mic] [Speak pill]
 */

import type { ReactNode } from "react";
import type { LiveSpeakState } from "./live-speak-control";

export type ComposerDictationState = "idle" | "recording";

export type ComposerModelId = "build" | "heavy" | "expert" | "fast" | "auto";

export type ComposerModelOption = {
  id: ComposerModelId;
  label: string;
  subtitle: string;
};

export const COMPOSER_MODEL_OPTIONS: ComposerModelOption[] = [
  { id: "build", label: "Build", subtitle: "Build apps and sites · Grok 4.7" },
  { id: "heavy", label: "Heavy", subtitle: "Team of Experts · Grok 4.7" },
  { id: "expert", label: "Expert", subtitle: "Thinks hard · Grok 4.7" },
  { id: "fast", label: "Fast", subtitle: "Quick responses · Grok 4.7" },
  { id: "auto", label: "Auto", subtitle: "Chooses Fast or Expert" },
];

export type ComposerVoiceButtonsProps = {
  dictationState?: ComposerDictationState;
  speakState?: LiveSpeakState;
  level?: number;
  onDictate?: () => void;
  onSpeak?: () => void;
  disabled?: boolean;
  className?: string;
};

function clampLevel(n: number | undefined): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Mic + Speak pair only (composer right edge). */
export function ComposerVoiceButtons(props: ComposerVoiceButtonsProps) {
  const dictation = props.dictationState ?? "idle";
  const speak = props.speakState ?? "off";
  const speakActive = speak !== "off";
  const level = clampLevel(props.level);
  const style = { ["--live-level" as string]: String(level) };

  return (
    <div
      className={`composer-voice-btns ${props.className ?? ""}`.trim()}
      data-testid="composer-voice-buttons"
      data-dictation={dictation}
      data-speak={speak}
      role="group"
      aria-label="Voice input"
      style={style}
    >
      <button
        type="button"
        className="composer-mic-dictation composer-mic-dictate"
        data-testid="composer-mic-dictate"
        data-state={dictation}
        aria-label="Dictate"
        aria-pressed={dictation === "recording"}
        onClick={props.onDictate}
        disabled={props.disabled}
      >
        <span className="composer-mic-dictation__glyph" aria-hidden="true" />
        <span className="composer-mic-dictation__dot" aria-hidden="true" />
      </button>

      <button
        type="button"
        className="composer-speak-live composer-speak-pill"
        data-testid="composer-speak"
        data-live-voice={speak}
        data-state={speak}
        aria-label={speakActive ? "Voice conversation active" : "Start voice conversation"}
        aria-pressed={speakActive}
        onClick={props.onSpeak}
        disabled={props.disabled}
      >
        <span className="composer-speak-live__bars" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
        <span className="composer-speak-live__label">Speak</span>
      </button>
    </div>
  );
}

export type ComposerBarProps = {
  dictationState?: ComposerDictationState;
  speakState?: LiveSpeakState;
  level?: number;
  /** null = current mode has no chip option (e.g. Orchestrator); show modelLabel, select nothing. */
  model?: ComposerModelId | null;
  /** Label override when model is null. */
  modelLabel?: string;
  modelMenuOpen?: boolean;
  askSlot?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onDictate?: () => void;
  onSpeak?: () => void;
  onPlus?: () => void;
  onModelToggle?: () => void;
  onModelSelect?: (id: ComposerModelId) => void;
  onAskFocus?: () => void;
};

/** Full Grok-like bottom-anchored composer card. */
export function ComposerBar(props: ComposerBarProps) {
  const model = props.model === null ? null : props.model ?? "heavy";
  const modelMeta =
    model === null
      ? { id: null, label: props.modelLabel || "Mode", subtitle: "" }
      : COMPOSER_MODEL_OPTIONS.find((o) => o.id === model) ?? COMPOSER_MODEL_OPTIONS[1];
  const level = clampLevel(props.level);
  const style = { ["--live-level" as string]: String(level) };

  return (
    <div
      className={`composer-bar ${props.className ?? ""}`.trim()}
      data-testid="composer-bar"
      data-model-menu={props.modelMenuOpen ? "open" : "closed"}
      style={style}
      role="region"
      aria-label="Message composer"
    >
      <div className="composer-bar__safe">
        <div className="composer-bar__card">
          <div className="composer-bar__ask" data-testid="composer-bar-ask">
            {props.askSlot ?? (
              <button
                type="button"
                className="composer-bar__ask-fake"
                onClick={props.onAskFocus}
                aria-label={props.placeholder ?? "Ask Anything"}
              >
                {props.placeholder ?? "Ask Anything"}
              </button>
            )}
          </div>

          <div className="composer-bar__row">
            <div className="composer-bar__left">
              <button
                type="button"
                className="composer-bar__plus"
                data-testid="composer-bar-plus"
                aria-label="Add attachment"
                onClick={props.onPlus}
                disabled={props.disabled}
              >
                <span className="composer-bar__plus-glyph" aria-hidden="true" />
              </button>

              <div className="composer-bar__model-wrap">
                <button
                  type="button"
                  className="composer-bar__model"
                  data-testid="composer-bar-model"
                  aria-haspopup="menu"
                  aria-expanded={!!props.modelMenuOpen}
                  onClick={props.onModelToggle}
                  disabled={props.disabled}
                >
                  <span className="composer-bar__model-ico" aria-hidden="true" />
                  <span className="composer-bar__model-label">{modelMeta.label}</span>
                  {model === "build" ? (
                    <span className="composer-bar__model-beta">BETA</span>
                  ) : null}
                </button>

                {props.modelMenuOpen ? (
                  <ul
                    className="composer-bar__model-menu"
                    role="menu"
                    aria-label="Model"
                    data-testid="composer-bar-model-menu"
                  >
                    {COMPOSER_MODEL_OPTIONS.map((opt) => {
                      const selected = opt.id === model;
                      return (
                        <li key={opt.id} role="none">
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={`composer-bar__model-option${selected ? " is-selected" : ""}`}
                            data-testid={`composer-bar-model-${opt.id}`}
                            onClick={() => props.onModelSelect?.(opt.id)}
                          >
                            <span className="composer-bar__model-option-text">
                              <span className="composer-bar__model-option-title">
                                {opt.label}
                                {opt.id === "build" ? (
                                  <span className="composer-bar__model-beta">BETA</span>
                                ) : null}
                              </span>
                              <span className="composer-bar__model-option-sub">{opt.subtitle}</span>
                            </span>
                            {selected ? (
                              <span className="composer-bar__model-check" aria-hidden="true" />
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            </div>

            <ComposerVoiceButtons
              dictationState={props.dictationState}
              speakState={props.speakState}
              level={props.level}
              onDictate={props.onDictate}
              onSpeak={props.onSpeak}
              disabled={props.disabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
