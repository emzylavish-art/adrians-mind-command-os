import { useEffect, useMemo, useState } from "react";
import {
  readStoredVoiceChoice,
  voiceDisplayName,
  writeStoredVoiceChoice,
  type XaiBuiltinVoice,
} from "@/lib/mind/voice/voices";

const STYLE_KEY = "adrian-speak-style";
const RATE_KEY = "adrian-speak-rate";
const AUTO_READ_KEY = "adrian-speak-auto-read";
const PINS_KEY = "adrian-speak-pins";

const VOICE_STYLES = ["Direct", "Warm", "Professional", "Playful"] as const;
const RATES = [
  { id: "slow", label: "Slow", value: 0.85 },
  { id: "natural", label: "Natural", value: 1 },
  { id: "brisk", label: "Brisk", value: 1.15 },
] as const;
const QUICK_VOICES = ["eve", "ara", "leo", "rex", "sal", "aurora"] as const satisfies readonly XaiBuiltinVoice[];

type VoiceStyle = (typeof VOICE_STYLES)[number];
type RateId = (typeof RATES)[number]["id"];
type LineKind = "Briefing" | "Decision" | "Follow-up";
type FilterId = "All" | LineKind | "Saved";

const FILTERS: FilterId[] = ["All", "Briefing", "Decision", "Follow-up", "Saved"];

const LINES: { id: string; kind: LineKind; text: string }[] = [
  { id: "status", kind: "Briefing", text: "Give me the status of open work in one minute." },
  { id: "recap", kind: "Briefing", text: "Recap what we just decided, then stop." },
  { id: "decide", kind: "Decision", text: "Compare the two options and recommend one." },
  { id: "risk", kind: "Decision", text: "Name the main risk and how we would notice it." },
  { id: "next", kind: "Follow-up", text: "What is the single next action, and who owns it?" },
  { id: "block", kind: "Follow-up", text: "What is blocked, and what would unblock it today?" },
];

const DEFAULT_NEXT = "Next: press the round Speak button in the composer, then allow the microphone if the browser asks.";

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function readPins(): string[] {
  const raw = readKey(PINS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const known = new Set(LINES.map((line) => line.id));
    return parsed.filter((id): id is string => typeof id === "string" && known.has(id));
  } catch {
    return [];
  }
}

function isStyle(value: string | null): value is VoiceStyle {
  return value !== null && (VOICE_STYLES as readonly string[]).includes(value);
}

function isRate(value: string | null): value is RateId {
  return value !== null && RATES.some((rate) => rate.id === value);
}

/**
 * Speak page controls. Preferences stay on this device.
 * Voice choice uses the same storage key the composer picker already reads.
 */
export function SpeakPanel() {
  const [voice, setVoice] = useState<XaiBuiltinVoice>("eve");
  const [style, setStyle] = useState<VoiceStyle>("Warm");
  const [rate, setRate] = useState<RateId>("natural");
  const [autoRead, setAutoRead] = useState(false);
  const [pins, setPins] = useState<string[]>([]);
  const [filter, setFilter] = useState<FilterId>("All");
  const [query, setQuery] = useState("");
  const [next, setNext] = useState(DEFAULT_NEXT);
  const [savedNote, setSavedNote] = useState("Preferences load from this browser.");

  useEffect(() => {
    const storedVoice = readStoredVoiceChoice(window.localStorage);
    const storedStyle = readKey(STYLE_KEY);
    const storedRate = readKey(RATE_KEY);
    const storedAuto = readKey(AUTO_READ_KEY);
    setVoice(storedVoice);
    if (isStyle(storedStyle)) setStyle(storedStyle);
    if (isRate(storedRate)) setRate(storedRate);
    setAutoRead(storedAuto === "on");
    setPins(readPins());
    setSavedNote("Loaded the voice, style, pace, and saved lines already stored in this browser.");
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return LINES.filter((line) => {
      if (filter === "Saved" && !pins.includes(line.id)) return false;
      if (filter !== "All" && filter !== "Saved" && line.kind !== filter) return false;
      if (!needle) return true;
      return `${line.kind} ${line.text}`.toLowerCase().includes(needle);
    });
  }, [filter, pins, query]);

  function noteSaved(label: string, ok: boolean) {
    setSavedNote(ok ? `Saved ${label} on this device.` : `Could not save ${label}. This browser is blocking storage.`);
  }

  function chooseVoice(nextVoice: XaiBuiltinVoice) {
    const stored = writeStoredVoiceChoice(nextVoice, window.localStorage);
    setVoice(stored);
    noteSaved(`${voiceDisplayName(stored)} as the Speak voice`, stored === nextVoice);
  }

  function chooseStyle(nextStyle: VoiceStyle) {
    setStyle(nextStyle);
    noteSaved(`${nextStyle} voice style`, writeKey(STYLE_KEY, nextStyle));
  }

  function chooseRate(nextRate: RateId) {
    setRate(nextRate);
    noteSaved(`${nextRate} pace`, writeKey(RATE_KEY, nextRate));
  }

  function toggleAutoRead() {
    const nextOn = !autoRead;
    setAutoRead(nextOn);
    noteSaved(nextOn ? "auto-read on" : "auto-read off", writeKey(AUTO_READ_KEY, nextOn ? "on" : "off"));
    setNext(
      nextOn
        ? "Next: send a chat message. With auto-read on, press Speak on that reply to hear it in the saved voice."
        : "Next: leave replies on screen. Press Speak on a message only when you want it read aloud.",
    );
  }

  function togglePin(id: string) {
    const nextPins = pins.includes(id) ? pins.filter((pin) => pin !== id) : [...pins, id];
    setPins(nextPins);
    const line = LINES.find((item) => item.id === id);
    noteSaved(line ? `“${line.text}”` : "that line", writeKey(PINS_KEY, JSON.stringify(nextPins)));
  }

  async function stateMicStep() {
    const fallback = "Next: press Speak in the composer and choose Allow when the microphone prompt appears.";
    if (!navigator.permissions?.query) {
      setNext(fallback);
      return;
    }
    try {
      const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
      if (status.state === "granted") {
        setNext("Next: press the round Speak button in the composer. The microphone is already allowed.");
      } else if (status.state === "denied") {
        setNext("Next: open the site lock icon in the address bar, set Microphone to Allow, reload, then press Speak.");
      } else {
        setNext(fallback);
      }
    } catch {
      setNext(fallback);
    }
  }

  function hearPace() {
    const sample = `${style} pace check. This is how replies will be paced.`;
    const playback = RATES.find((item) => item.id === rate)?.value ?? 1;
    if (!window.speechSynthesis) {
      setNext("Next: this browser has no local speech. Press Speak in the composer to use the signed-in voice instead.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(sample);
    utterance.rate = playback;
    window.speechSynthesis.speak(utterance);
    setNext("Next: if you heard the sample, press Speak in the composer. If it stayed silent, allow sound for this site and press Hear pace again.");
  }

  return (
    <section className="speak-panel" aria-labelledby="speak-panel-title" data-testid="speak-panel">
      <style>{PANEL_CSS}</style>
      <header className="speak-panel__head">
        <h1 id="speak-panel-title">Speak</h1>
        <p>Set how replies sound, keep a short prompt list, and follow the exact next step before a live turn.</p>
      </header>

      <p className="speak-panel__next" role="status">
        {next}
      </p>
      <p className="speak-panel__note">{savedNote}</p>

      <div className="speak-panel__actions">
        <button type="button" onClick={() => void stateMicStep()}>
          Check microphone, then show the next step
        </button>
        <button type="button" onClick={hearPace}>
          Hear pace, then show the next step
        </button>
        <button type="button" onClick={() => setNext(DEFAULT_NEXT)}>
          Show how to start Speak
        </button>
        <button type="button" aria-pressed={autoRead} onClick={toggleAutoRead}>
          {autoRead ? "Auto-read is on" : "Auto-read is off"}
        </button>
      </div>

      <fieldset className="speak-panel__group">
        <legend>Voice saved for the composer</legend>
        <div className="speak-panel__row" role="group" aria-label="Voice">
          {QUICK_VOICES.map((id) => (
            <button key={id} type="button" aria-pressed={voice === id} onClick={() => chooseVoice(id)}>
              {voiceDisplayName(id)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="speak-panel__group">
        <legend>Style saved for the Speak stage</legend>
        <div className="speak-panel__row" role="group" aria-label="Voice style">
          {VOICE_STYLES.map((item) => (
            <button key={item} type="button" aria-pressed={style === item} onClick={() => chooseStyle(item)}>
              {item}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="speak-panel__group">
        <legend>Pace saved on this device</legend>
        <div className="speak-panel__row" role="group" aria-label="Pace">
          {RATES.map((item) => (
            <button key={item.id} type="button" aria-pressed={rate === item.id} onClick={() => chooseRate(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="speak-panel__list">
        <div className="speak-panel__list-head">
          <h2>Prompt lines</h2>
          <label>
            Filter text
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by a word"
              aria-label="Filter prompt lines"
            />
          </label>
        </div>
        <div className="speak-panel__row" role="group" aria-label="Filter prompt lines">
          {FILTERS.map((item) => (
            <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>
              {item === "Saved" ? `Saved (${pins.length})` : item}
            </button>
          ))}
        </div>
        <p className="speak-panel__count">
          {visible.length === 1 ? "1 line" : `${visible.length} lines`}
          {filter === "All" ? "" : ` in ${filter}`}
          {query.trim() ? ` matching “${query.trim()}”` : ""}.
        </p>
        {visible.length === 0 ? (
          <p className="speak-panel__empty">
            {filter === "Saved"
              ? "No saved lines yet. Next: press Save on a line you want back, or press All to see every line."
              : "No lines match this filter. Next: clear the text or press All."}
          </p>
        ) : (
          <ul>
            {visible.map((line) => {
              const saved = pins.includes(line.id);
              return (
                <li key={line.id}>
                  <p>
                    <span>{line.kind}</span>
                    {line.text}
                  </p>
                  <div className="speak-panel__row">
                    <button
                      type="button"
                      onClick={() =>
                        setNext(`Next: paste “${line.text}” into the composer, then press the round Speak button.`)
                      }
                    >
                      Use this line next
                    </button>
                    <button type="button" aria-pressed={saved} onClick={() => togglePin(line.id)}>
                      {saved ? "Saved" : "Save"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export default SpeakPanel;

const PANEL_CSS = `
.speak-panel {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1rem;
  color: var(--color-fg, #f4f6fb);
  font-family: var(--font-sans, system-ui, sans-serif);
}
.speak-panel *, .speak-panel *::before, .speak-panel *::after { box-sizing: border-box; }
.speak-panel__head h1 {
  margin: 0;
  font-size: clamp(1.5rem, 2.4vw, 2rem);
  line-height: 1.15;
  letter-spacing: -0.03em;
}
.speak-panel__head p,
.speak-panel__note,
.speak-panel__count,
.speak-panel__empty {
  margin: 0.35rem 0 0;
  color: var(--color-muted, #9aa3b5);
  overflow-wrap: anywhere;
}
.speak-panel__next {
  margin: 0;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--color-line, #243044);
  border-radius: 0.85rem;
  background: var(--color-surface-2, #141a24);
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.speak-panel__actions,
.speak-panel__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
}
.speak-panel button,
.speak-panel input {
  max-width: 100%;
  min-width: 0;
  min-height: 2.75rem;
  border: 1px solid var(--color-line, #243044);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1.3;
}
.speak-panel button {
  padding: 0.45rem 0.85rem;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: left;
}
.speak-panel button[aria-pressed="true"] {
  background: var(--color-accent, #e8ecf5);
  color: var(--color-accent-ink, #0a0d14);
  border-color: transparent;
}
.speak-panel__group {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.speak-panel__group legend,
.speak-panel__list h2 {
  padding: 0;
  margin: 0 0 0.45rem;
  font-size: 0.95rem;
}
.speak-panel__list {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.speak-panel__list-head {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 0.65rem;
}
.speak-panel__list-head label {
  display: flex;
  flex: 1 1 12rem;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  color: var(--color-muted, #9aa3b5);
  font-size: 0.85rem;
}
.speak-panel input {
  width: 100%;
  border-radius: 0.75rem;
  padding: 0.45rem 0.75rem;
  background: var(--color-surface, #0c1018);
}
.speak-panel ul {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.speak-panel li {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-line, #243044);
}
.speak-panel li p {
  flex: 1 1 16rem;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
.speak-panel li span {
  display: block;
  margin-bottom: 0.15rem;
  color: var(--color-muted, #9aa3b5);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
@media (min-width: 64rem) {
  .speak-panel { padding: 1.25rem 0.25rem 1.25rem 0; }
}
`;
