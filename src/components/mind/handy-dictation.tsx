import { useEffect, useRef, useState } from "react";
import { ActionOverlay } from "@/components/mind/conversation-menu";
import {
  HANDY_SOURCE,
  HANDY_WHISPER_URL,
  fieldLabel,
  handyBarHeight,
  handyLiveLevels,
  isTypingField,
} from "@/lib/mind/handy-dictation";
import { createWhisperSession, type WhisperSession } from "@/lib/mind/whisper-flow/session";
import { SOKUJI_SOURCE, TRANSLATOR_TARGETS, translateVoice } from "@/lib/mind/voice-translator";

type Phase = "idle" | "speak" | "saved";

export function HandyDictation() {
  const field = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const session = useRef<WhisperSession | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [label, setLabel] = useState("");
  const [levels, setLevels] = useState<number[]>(handyLiveLevels(0));
  const [note, setNote] = useState("Dictate types into the field. Speak is the call.");
  const [target, setTarget] = useState("es");
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

  useEffect(() => {
    if (phase !== "speak") return;
    const id = window.setInterval(() => {
      setLevels(handyLiveLevels(Date.now()));
    }, 120);
    return () => {
      window.clearInterval(id);
    };
  }, [phase]);

  function liveSession() {
    if (session.current) return session.current;
    session.current = createWhisperSession({
      speechCtor: () => null,
      onState: (next) => {
        if (next.level > 0) setLevels(handyLiveLevels(next.level * 12));
        if (next.phase === "listening" || next.phase === "transcribing") setPhase("speak");
        if (next.error) setNote(next.error);
      },
      transcribe: async (input) => {
        const bytes = Uint8Array.from(atob(input.audioBase64), (char) => char.charCodeAt(0));
        const response = await fetch(HANDY_WHISPER_URL, {
          method: "POST",
          headers: { "content-type": input.mime || "application/octet-stream" },
          body: bytes,
        });
        const body = await response.json() as { ok?: boolean; text?: string; engine?: string; error?: string };
        const text = body.text?.trim() ?? "";
        if (!response.ok || !body.ok || !text) {
          return { ok: false, error: body.error || "Whisper heard no words. Nothing was sent to Google." };
        }
        setEngine(body.engine || "transcribe.cpp");
        return { ok: true, text, provider: "handy" };
      },
    });
    return session.current;
  }

  async function start() {
    setPhase("speak");
    setEngine("");
    setNote(label ? `Dictate into ${label}. This is not the call.` : "Dictate into the field. This is not the call.");
    field.current?.focus();
    try {
      await liveSession().start();
    } catch {
      setNote("This browser could not open the microphone. Nothing was sent to Google.");
    }
  }

  async function mark() {
    const current = field.current;
    if (!current) {
      setNote("Focus a typing field first. Nothing was saved.");
      return;
    }
    const live = session.current;
    if (!live || live.getState().phase === "idle") {
      setNote("Press Dictate and speak first. Nothing was saved.");
      return;
    }
    try {
      current.focus();
      await live.stop();
      setPhase("saved");
      setNote(`Saved into ${fieldLabel(current)} from Handy Whisper. Speak was not opened.`);
    } catch {
      setNote("Handy Whisper is not running on this machine. Nothing was sent to Google.");
    }
  }

  function translate() {
    const text = field.current?.value.trim() || "";
    const result = translateVoice(text, target);
    setTranslation(result.text || result.note);
    setNote(result.note);
  }

  function pinRow(node: HTMLDivElement | null) {
    if (!node) return;
    node.style.setProperty("position", "relative", "important");
    node.style.setProperty("z-index", "4", "important");
    node.style.setProperty("flex", "0 0 auto", "important");
    node.style.setProperty("background", light ? "#f7f7f8" : "#07080c", "important");
    node.style.setProperty("color", light ? "#18181b" : "#fafafa", "important");
  }

  return (
    <div
      ref={pinRow}
      className="flex w-full shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 py-2"
      style={{ position: "relative", zIndex: 4, flex: "0 0 auto", background: light ? "#f7f7f8" : "#07080c", color: light ? "#18181b" : "#fafafa" }}
      data-testid="handy-dictation"
      data-phase={phase}
      data-field={label}
      data-source={HANDY_SOURCE}
      data-translator={SOKUJI_SOURCE}
      data-detector="handy"
      data-flow="whisper-flow"
      data-engine={engine || "transcribe.cpp"}
      data-model="whisper-tiny.en"
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
      <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" data-testid="handy-mic" aria-label="Dictate" title="Dictate types into the field. This is not Speak." onClick={() => void start()}>
        Dictate
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
      {phase === "speak" || phase === "saved" ? <strong data-testid="handy-speak-sign">Listening</strong> : null}
      <p className="min-w-0 flex-1 basis-full whitespace-normal text-xs leading-5 text-muted sm:basis-auto" data-testid="handy-note" title={note}>{note}</p>
      {translation ? <p className="text-sm" data-testid="voice-translation">{translation}</p> : null}
      {actionsOpen ? (
        <ActionOverlay label="Actions for dictation" title="Dictation" onClose={() => setActionsOpen(false)}>
          <button type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" data-testid="handy-mark" onClick={() => { setActionsOpen(false); void mark(); }}>
            Mark
          </button>
          <label className="flex min-h-11 items-center justify-between gap-2 px-3 text-sm">
            Translate to
            <select aria-label="Translation language" data-testid="voice-language" value={target} onChange={(event) => setTarget(event.target.value)} className="min-h-11 rounded-panel border border-line bg-transparent px-2">
              {TRANSLATOR_TARGETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <button type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" data-testid="voice-translate" data-engine="sokuji" data-model="opus-mt" data-google="false" onClick={() => { setActionsOpen(false); translate(); }}>
            Translate
          </button>
        </ActionOverlay>
      ) : null}
    </div>
  );
}
