import { useEffect, useRef, useState } from "react";
import { ActionOverlay } from "@/components/mind/conversation-menu";
import {
  HANDY_SOURCE,
  fieldLabel,
  handyBarHeight,
  handyLiveLevels,
  isTypingField,
} from "@/lib/mind/handy-dictation";
import { createWhisperSession, type WhisperSession, type BrowserSpeechCtor } from "@/lib/mind/whisper-flow/session";
import { SOKUJI_SOURCE, TRANSLATOR_TARGETS, translateVoice } from "@/lib/mind/voice-translator";
import { readVoiceRoutePreferences } from "@/lib/mind/voice/route-preferences";
import { useAccountPreferences } from "./account-preferences-context";
import { readVoicePreferences, formatDictation, recordDictation } from "@/lib/mind/voice-preferences";
import { finishDictation } from "@/lib/mind/system-dictation";

type Phase = "idle" | "speak" | "saved";

export function HandyDictation({ freeOnly = false, ownerId }: { freeOnly?: boolean; ownerId?: string | null }) {
  const storage = useAccountPreferences();
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const destination = useRef<{ field: HTMLTextAreaElement | HTMLInputElement; owner: typeof ownerId } | null>(null);
  const [interim, setInterim] = useState("");
  const currentOwner = useRef(ownerId);
  currentOwner.current = ownerId;
  const currentFreeOnly = useRef(freeOnly);
  currentFreeOnly.current = freeOnly;
  const field = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const session = useRef<WhisperSession | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [label, setLabel] = useState("");
  const [levels, setLevels] = useState<number[]>(handyLiveLevels(0));
  const [note, setNote] = useState("Mic types into the field. Translator translates. Speak is the call.");
  const [target, setTarget] = useState("en");
  const [languageQuery, setLanguageQuery] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [translation, setTranslation] = useState("");
  const [engine, setEngine] = useState("");
  const [light, setLight] = useState(false);

  useEffect(() => {
    const read = () => setLight(document.documentElement.dataset.theme === "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = document.querySelector("[data-testid='handy-dictation']");
    if (!(node instanceof HTMLElement)) return;
    node.style.setProperty("background", light ? "#f7f7f8" : "#07080c", "important");
    node.style.setProperty("color", light ? "#18181b" : "#fafafa", "important");
  }, [light]);

  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      if (!isTypingField(event.target)) return;
      field.current = event.target;
      setLabel(fieldLabel(event.target));
    };
    const onMic = () => { void start(); };
    document.addEventListener("focusin", onFocus);
    window.addEventListener("adrian:handy-mic", onMic);
    return () => {
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("adrian:handy-mic", onMic);
      session.current?.cancel();
    };
  }, []);

  useEffect(() => { session.current?.cancel(); session.current = null; destination.current = null; field.current = null; setInterim(""); setPhase("idle"); setEngine(""); }, [ownerId]);
  useEffect(() => {
    const changed = () => {
      const prefs = readVoicePreferences(storage);
      if (!prefs.live) setInterim("");
      if (!prefs.enabled) { session.current?.cancel(); destination.current = null; setPhase("idle"); }
    };
    window.addEventListener("adrian-dictation-preferences", changed);
    return () => window.removeEventListener("adrian-dictation-preferences", changed);
  }, [storage]);

  useEffect(() => {
    if (phase !== "speak") setLevels(Array.from({ length: 9 }, () => 0.08));
  }, [phase]);

  function liveSession() {
    if (session.current) return session.current;
    session.current = createWhisperSession({
      language: () => readVoicePreferences(storageRef.current).language || navigator.language,
      formatTranscript: raw => formatDictation(raw, readVoicePreferences(storageRef.current).dictionary),
      canInsert: () => Boolean(destination.current?.field.isConnected && destination.current.owner === currentOwner.current && readVoicePreferences(storageRef.current).enabled),
      onInterim: text => { if (readVoicePreferences(storageRef.current).live) setInterim(text); },
      speechCtor: () => {
        if (readVoiceRoutePreferences(window.localStorage, currentOwner.current).sttProvider !== "browser") return null;
        const host = window as Window & {
          SpeechRecognition?: BrowserSpeechCtor;
          webkitSpeechRecognition?: BrowserSpeechCtor;
        };
        return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
      },
      onState: (next) => {
        if (next.level > 0) setLevels(Array.from({ length: 9 }, (_, index) => Math.max(0.08, Math.min(1, next.level * (0.55 + (index % 3) * 0.15)))));
        if (next.phase === "listening" || next.phase === "transcribing") setPhase("speak");
        else if (next.phase === "idle" || next.phase === "error") setPhase("idle");
        if (next.error) setNote(next.error);
      },
      onInserted: (text) => {
        const target = destination.current;
        if (!target?.field.isConnected || target.owner !== currentOwner.current || !text.trim()) return;
        setInterim("");
        recordDictation(storageRef.current, text);
        setNote(`Words inserted in ${fieldLabel(target.field)}.`);
      },
      transcribe: async (input) => {
        if (currentFreeOnly.current) return { ok: false, error: "Free-only mode keeps cloud transcription off." };
        const route = readVoiceRoutePreferences(window.localStorage, currentOwner.current);
        if (route.sttProvider === "browser") return { ok: false, error: "This dictation recorder needs a cloud transcription service. Choose xAI or OpenAI in Voice settings, or use browser speech in Speak." };
        const response = await fetch("/api/mind/voice/stt", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            audioBase64: input.audioBase64, freeOnly: currentFreeOnly.current,
            provider: route.sttProvider, fallbackProvider: route.sttFallbackProvider,
            language: readVoicePreferences(storageRef.current).language || navigator.language,
            mime: input.mime || "audio/webm",
            filename: (input.mime || "").includes("mp4") ? "dictation.m4a" : "dictation.webm",
          }),
        });
        const body = await response.json() as { ok?: boolean; text?: string; provider?: string; error?: string };
        const text = body.text?.trim() ?? "";
        if (!response.ok || !body.ok || !text) {
          return { ok: false, error: body.error || "Nothing was transcribed. Nothing was sent." };
        }
        const provider = body.provider || "Transcription provider not reported";
        setEngine(provider);
        return { ok: true, text, provider };
      },
    });
    return session.current;
  }

  async function start() {
    if (!readVoicePreferences(storageRef.current).enabled) { setPhase("saved"); setNote("Enable dictation in Voice settings to use the microphone."); return; }
    if (!field.current?.isConnected) { setPhase("saved"); setNote("Choose a text field before starting dictation."); return; }
    destination.current = { field: field.current, owner: currentOwner.current };
    setInterim(""); setEngine("");
    setNote("Opening the microphone. The recording goes to your selected transcription service; text enters the field without sending a chat message.");
    field.current?.focus();
    try {
      await liveSession().start();
    } catch {
      setPhase("idle");
      setNote("This browser could not open the microphone. Nothing was transcribed.");
    }
  }

  async function mark() {
    const current = destination.current?.field.isConnected ? destination.current.field : null;
    const live = session.current;
    if (!live || live.getState().phase === "idle") {
      setNote("Press Mic and speak first. Nothing was inserted.");
      return;
    }
    try {
      await live.stop();
      const transcript = live.segments.join(" ").trim();
      const decision = finishDictation({ transcript, hasFocusedField: Boolean(current && isTypingField(current)) });
      setPhase("saved");
      setNote(decision.note);
    } catch {
      setNote("Dictation could not finish. Nothing was inserted and nothing was sent.");
    }
  }

  function translate() {
    const text = field.current?.value.trim() || "";
    setNote("Translator is asking Opus-MT. Nothing is sent to Google.");
    void translateVoice(text, target).then((result) => {
      setTranslation(result.text || "");
      setNote(result.note);
    }).catch(() => {
      setTranslation("");
      setNote("Opus-MT is not running on this machine. Nothing was sent to Google.");
    });
  }

  function pinRow(node: HTMLDivElement | null) {
    if (!node) return;
    node.style.setProperty("position", "fixed", "important");
    node.style.setProperty("z-index", "4", "important");
    node.style.setProperty("left", "50%", "important");
    node.style.setProperty("bottom", "5.5rem", "important");
    node.style.setProperty("transform", "translateX(-50%)", "important");
    node.style.setProperty("width", "auto", "important");
    node.style.setProperty("max-width", "min(22rem, calc(100% - 1.5rem))", "important");
    node.style.setProperty("background", light ? "#f7f7f8" : "#07080c", "important");
    node.style.setProperty("color", light ? "#18181b" : "#fafafa", "important");
  }

  useEffect(() => {
    const open = () => setActionsOpen(true);
    window.addEventListener("adrian:open-translator", open);
    return () => window.removeEventListener("adrian:open-translator", open);
  }, []);

  if (phase === "idle" && !actionsOpen) return null;

  return (
    <div
      ref={pinRow}
      className="flex w-auto flex-wrap items-center gap-2 rounded-3xl border border-line px-3 py-2 shadow-lg"
      style={{ position: "fixed", zIndex: 30, left: "50%", bottom: "5.5rem", transform: "translateX(-50%)", width: "auto", maxWidth: "min(22rem, calc(100% - 1.5rem))", background: light ? "#f7f7f8" : "#07080c", color: light ? "#000" : "#fafafa" }}
      data-testid="handy-dictation"
      data-phase={phase}
      data-field={label}
      data-source={HANDY_SOURCE}
      data-translator={SOKUJI_SOURCE}
      data-detector="handy"
      data-flow="whisper-flow"
      data-engine={engine || "pending"}
      data-model="not-reported"
      data-google="false"
      data-speak="separate"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button, select, label")) return;
        const timer = window.setTimeout(() => setActionsOpen(true), 550);
        event.currentTarget.dataset.hold = String(timer);
      }}
      onPointerUp={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
      onPointerLeave={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
      onPointerCancel={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
    >
      <button type="button" className="min-h-11 rounded-full border border-line px-3 text-sm" data-testid="handy-cancel" onClick={() => { session.current?.cancel(); setPhase("idle"); setActionsOpen(false); setNote("Cancelled. The recording was discarded. Text already in the field was kept."); }}>
        Cancel
      </button>
      <button type="button" className="min-h-11 rounded-full border border-line px-3 text-sm" data-testid="dictation-done" aria-label="Done" title="Finish transcription and insert the words at the cursor. The chat message is not sent." onClick={() => { void mark(); }}>
        ✓
      </button>
      {phase === "speak" || phase === "saved" ? (
        <span className="inline-flex items-end gap-1" data-testid="handy-wave" data-live="true" aria-label="Speech is live">
          {levels.map((level, index) => (
            <i
              key={index}
              style={{ display: "block", width: 4, borderRadius: 2, background: "#d4d4d8", height: handyBarHeight(level) }}
            />
          ))}
        </span>
      ) : null}
      {phase === "speak" && <strong data-testid="handy-speak-sign">Listening</strong>}
      {phase === "speak" && interim && <span role="status">{interim}</span>}
      <p className="min-w-0 flex-1 basis-full whitespace-normal text-xs leading-5 text-muted sm:basis-auto" data-testid="handy-note" title={note}>{note}</p>
      {translation ? <p className="text-sm" data-testid="voice-translation">{translation}</p> : null}
      {actionsOpen ? (
        <ActionOverlay label="Translator" title="Translator" onClose={() => setActionsOpen(false)}>
          <button type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" data-testid="handy-mark" onClick={() => { setActionsOpen(false); void mark(); }}>
            Mark
          </button>
          <label className="flex min-h-11 items-center justify-between gap-2 px-3 text-sm">
            Translate to
            <select aria-label="Translation language" data-testid="voice-language" value={target} onChange={(event) => setTarget(event.target.value)} className="min-h-11 max-w-[60%] rounded-panel border border-line bg-transparent px-2">
              {TRANSLATOR_TARGETS.filter((item) => `${item.label} ${item.id}`.toLowerCase().includes(languageQuery.trim().toLowerCase())).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 px-3 text-sm">
            Find a language
            <input aria-label="Find a language" data-testid="voice-language-search" value={languageQuery} onChange={(event) => setLanguageQuery(event.target.value)} className="min-h-11 flex-1 rounded-panel border border-line bg-transparent px-2" placeholder="English, Yoruba, Chinese" />
          </label>
          <button type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" data-testid="voice-translate" data-engine="sokuji" data-model="opus-mt" data-google="false" onClick={() => { setActionsOpen(false); translate(); }}>
            Translate
          </button>
        </ActionOverlay>
      ) : null}
    </div>
  );
}
