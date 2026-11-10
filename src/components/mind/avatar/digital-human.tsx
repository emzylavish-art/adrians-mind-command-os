import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { characterById, readStoredCharacterId } from "@/lib/mind/characters";
import { sharedAudioOutput } from "@/lib/mind/voice/audio-output";
import {
  expressionForPresence,
  isAvatarFraming,
  plateForExpression,
  type AvatarExpression,
  type AvatarFraming,
} from "@/lib/mind/avatar/presence";
import { readAvatarSession, subscribeAvatarSession } from "@/lib/mind/avatar/session";
import { selectFaceSrc, speechFrame } from "@/lib/mind/avatar/face-src";
import { type VisemeId } from "@/lib/mind/avatar/visemes";
import { HumanStage } from "@/components/mind/avatar/human-stage";

const FRAMING_KEY = "amcos.avatar.framing.v1";
/** Mouth band on the original headshot plates, as fractions of the plate. */
const MOUTH = { x: 0.38, y: 0.58, w: 0.24, h: 0.11 };
const EYES = [
  { x: 0.38, y: 0.415 },
  { x: 0.62, y: 0.415 },
];

type AudioClock = { playing: boolean; current: number; duration: number };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(src));
    image.src = src;
  });
}

function layoutFor(framing: AvatarFraming, width: number, height: number) {
  const scale = framing === "face" ? 1.65 : framing === "compact" ? 1.9 : framing === "upper" ? 1.08 : 1;
  const dw = width * scale;
  const dh = height * scale;
  const dx = (width - dw) / 2;
  const dy = framing === "face" || framing === "compact" ? height * 0.02 - (dh - height) * 0.42 : (height - dh) / 2;
  return { dx, dy, dw, dh };
}

export function DigitalHuman({
  framing = "upper",
  characterId,
  expression,
  className = "",
}: {
  framing?: AvatarFraming;
  characterId?: string;
  expression?: AvatarExpression | null;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const session = useSyncExternalStore(subscribeAvatarSession, readAvatarSession, readAvatarSession);
  const [storedId, setStoredId] = useState(() => readStoredCharacterId(typeof localStorage === "undefined" ? null : localStorage));
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [flat, setFlat] = useState(false);
  const useFlat = useCallback(() => setFlat(true), []);
  const images = useRef(new Map<string, HTMLImageElement>());
  const clockRef = useRef<AudioClock>({ playing: false, current: 0, duration: 0 });
  const id = characterId || storedId;
  const character = characterById(id) ?? characterById("eve")!;

  useEffect(() => {
    const sync = () => setStoredId(readStoredCharacterId(localStorage));
    window.addEventListener("amcos-character", sync);
    return () => window.removeEventListener("amcos-character", sync);
  }, []);

  useEffect(() => sharedAudioOutput.onClock((next) => {
    clockRef.current = next;
  }), []);

  useEffect(() => {
    if (!flat) return;
    let canceled = false;
    setReady(false);
    setFailed(null);
    images.current.clear();
    const sources = new Set<string>([
      character.portrait,
      ...Object.values(character.visemes),
      ...Object.values(character.expressions),
      ...(character.fullBody ? [character.fullBody] : []),
    ]);
    void Promise.all([...sources].map(async (src) => {
      const image = await loadImage(src);
      images.current.set(src, image);
    })).then(() => {
      if (!canceled) setReady(true);
    }).catch(() => {
      if (!canceled) setFailed(`${character.name}'s portrait did not load. Nothing is being simulated.`);
    });
    return () => {
      canceled = true;
    };
  }, [character, flat]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready || !flat) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setFailed("This browser could not open a drawing surface for the portrait.");
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let frame = 0;
    let blinkUntil = 0;
    let nextBlink = performance.now() + 2800;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const live = readAvatarSession();
      const clock = clockRef.current;
      const speech = speechFrame(live.presence, live.utterance, live.startedAt, clock, Date.now());
      const viseme: VisemeId = speech.viseme;
      const presencePlate = plateForExpression(expression ?? expressionForPresence(live.presence));
      const baseSrc = speech.speaking
        ? character.portrait
        : framing === "full" && character.fullBody && presencePlate === "neutral"
          ? character.fullBody
          : selectFaceSrc(character, live.presence, expression ?? null, "rest", false);
      const base = images.current.get(baseSrc) ?? images.current.get(character.portrait);
      if (!base) return;
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#141414";
      ctx.fillRect(0, 0, width, height);
      const breath = reduced ? 1 : 1 + Math.sin(now / 900) * 0.006;
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(breath, breath);
      ctx.translate(-width / 2, -height / 2);
      const { dx, dy, dw, dh } = layoutFor(framing, width, height);
      ctx.drawImage(base, dx, dy, dw, dh);
      const fullBody = baseSrc === character.fullBody;
      if (!fullBody && speech.speaking && viseme !== "rest") {
        const mouthSrc = character.visemes[viseme] ?? character.visemes.aa;
        const mouth = mouthSrc ? images.current.get(mouthSrc) : undefined;
        if (mouth) {
          ctx.save();
          ctx.beginPath();
          const mx = dx + MOUTH.x * dw;
          const my = dy + MOUTH.y * dh;
          const mw = MOUTH.w * dw;
          const mh = MOUTH.h * dh;
          ctx.ellipse(mx + mw / 2, my + mh / 2, mw / 2, mh / 2, 0, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(mouth, dx, dy, dw, dh);
          ctx.restore();
        }
      }
      if (!fullBody && !reduced && !speech.speaking && now < blinkUntil) {
        try {
          const sample = ctx.getImageData(Math.floor(width * 0.5), Math.floor(height * 0.28), 1, 1).data;
          ctx.fillStyle = `rgba(${sample[0]}, ${sample[1]}, ${sample[2]}, 0.92)`;
          for (const eye of EYES) {
            ctx.beginPath();
            ctx.ellipse(dx + eye.x * dw, dy + eye.y * dh, dw * 0.045, dh * 0.012, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        } catch {
          /* tainted canvas — skip the blink rather than invent an eye */
        }
      } else if (!reduced && now > nextBlink) {
        blinkUntil = now + 140;
        nextBlink = now + 2600 + Math.random() * 2200;
      }
      ctx.restore();
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [character, expression, flat, framing, ready]);

  const label = failed ? "Unavailable" : flat && !ready ? "Loading portrait…" : session.presence.replaceAll("_", " ");
  return (
    <figure className={`overflow-hidden rounded-2xl border border-line bg-black ${className}`} data-testid="digital-human" data-character={character.id} data-framing={framing} data-presence={session.presence}>
      {flat ? (
        <canvas ref={canvasRef} width={720} height={960} className="block h-auto w-full" aria-label={`${character.name}, ${label}`} />
      ) : (
        <HumanStage characterId={character.id} framing={framing} expression={expression} onFail={useFlat} />
      )}
      <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted">
        <span>{character.name} · {character.role}</span>
        <span role="status">{label}</span>
      </figcaption>
    </figure>
  );
}

export function readStoredFraming(): AvatarFraming {
  try {
    const value = localStorage.getItem(FRAMING_KEY);
    return isAvatarFraming(value) ? value : "upper";
  } catch {
    return "upper";
  }
}

export function writeStoredFraming(value: AvatarFraming): void {
  try {
    localStorage.setItem(FRAMING_KEY, value);
  } catch {
    /* private mode */
  }
}
