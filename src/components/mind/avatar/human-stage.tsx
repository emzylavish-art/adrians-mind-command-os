import { useEffect, useRef } from "react";
import * as THREE from "three";
import { characterById } from "@/lib/mind/characters";
import type { AvatarExpression, AvatarFraming } from "@/lib/mind/avatar/presence";
import { readAvatarSession } from "@/lib/mind/avatar/session";
import { sharedAudioOutput } from "@/lib/mind/voice/audio-output";
import { selectFaceSrc, speechFrame } from "@/lib/mind/avatar/face-src";
import type { EveProjection } from "@/lib/mind/eve-projection";
import {
  CHARACTER_LOOK,
  applyGaze,
  applyIdle,
  applyViseme,
  cameraForFraming,
  createHumanRig,
  faceMaterial,
} from "@/lib/mind/avatar/human-rig";

function coverEyes(ctx: CanvasRenderingContext2D, shiftX: number) {
  const sample = ctx.getImageData(256, 230, 1, 1).data;
  ctx.fillStyle = `rgba(${sample[0]}, ${sample[1]}, ${sample[2]}, 0.98)`;
  ctx.beginPath();
  ctx.ellipse(270 + shiftX, 174, 156, 26, 0, 0, Math.PI * 2);
  ctx.fill();
}

function mouthOpen(viseme: string) {
  if (viseme === "aa") return 1;
  if (viseme === "oo") return 0.78;
  if (viseme === "ee") return 0.46;
  if (viseme === "mm") return 0.16;
  return 0.62;
}

function openMouth(ctx: CanvasRenderingContext2D, amount: number, shiftX: number) {
  const cx = 274 + shiftX;
  const top = 330;
  const gap = 5 + 8 * amount;
  ctx.fillStyle = "rgba(28, 14, 16, 0.96)";
  ctx.beginPath();
  ctx.ellipse(cx, top + gap / 2, 22, gap / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function liftMouth(ctx: CanvasRenderingContext2D, direction: 1 | -1, shiftX: number) {
  const shift = direction * 3;
  for (const x of [248, 292]) {
    const left = Math.round(x + shiftX);
    const patch = ctx.getImageData(left, 336, 16, 12);
    ctx.putImageData(patch, left, 336 - shift);
  }
}

export function HumanStage({
  characterId,
  framing,
  expression,
  faceSrc,
  projection,
  onFail,
}: {
  characterId: string;
  framing: AvatarFraming;
  expression?: AvatarExpression | null;
  faceSrc?: string;
  projection?: EveProjection;
  onFail: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const liveRef = useRef({ framing, expression, onFail, faceSrc: faceSrc ?? "", projection });
  liveRef.current = { framing, expression, onFail, faceSrc: faceSrc ?? "", projection };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const character = characterById(characterId) ?? characterById("eve");
    if (!character) {
      liveRef.current.onFail();
      return;
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      liveRef.current.onFail();
      return;
    }
    renderer.setClearColor(0x101014, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const look = CHARACTER_LOOK[character.id] ?? CHARACTER_LOOK.eve!;
    const rig = createHumanRig(look);
    scene.add(rig);
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 4.2),
      new THREE.MeshBasicMaterial({ color: 0x101014 }),
    );
    backdrop.name = "eve-backdrop";
    backdrop.position.set(0, 1.15, -1.6);
    scene.add(backdrop);
    const screenCanvas = document.createElement("canvas");
    screenCanvas.width = 256;
    screenCanvas.height = 160;
    const screenContext = screenCanvas.getContext("2d");
    const screenTexture = new THREE.CanvasTexture(screenCanvas);
    screenTexture.colorSpace = THREE.SRGBColorSpace;
    const computer = new THREE.Mesh(
      new THREE.PlaneGeometry(0.46, 0.29),
      new THREE.MeshBasicMaterial({ map: screenTexture }),
    );
    computer.name = "eve-computer";
    computer.position.set(1.05, 0.95, 0.2);
    scene.add(computer);
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.42, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.7 }),
    );
    stand.position.set(1.05, 0.58, 0.2);
    scene.add(stand);
    let shownProjection = "";
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.35, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.001;
    scene.add(shadow);
    scene.add(new THREE.HemisphereLight(0xe7eeff, 0x1a140f, 0.9));
    const key = new THREE.DirectionalLight(0xfff4e8, 1.45);
    key.position.set(0.7, 2.6, 1.6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9eb6ff, 0.4);
    rim.position.set(-1.4, 1.8, -0.6);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xfff6ee, 1.1);
    fill.position.set(0.2, 1.4, 2.8);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
    const faceCanvas = document.createElement("canvas");
    faceCanvas.width = 512;
    faceCanvas.height = 512;
    const faceCtx = faceCanvas.getContext("2d");
    const faceTexture = new THREE.CanvasTexture(faceCanvas);
    (window as unknown as { __eveFaceCanvas?: HTMLCanvasElement }).__eveFaceCanvas = faceCanvas;
    faceTexture.colorSpace = THREE.SRGBColorSpace;
    faceTexture.wrapS = THREE.ClampToEdgeWrapping;
    faceTexture.wrapT = THREE.ClampToEdgeWrapping;
    const material = faceMaterial(rig);
    if (material && faceCtx) {
      material.map = faceTexture;
      material.side = THREE.FrontSide;
      material.transparent = true;
      material.alphaTest = 0.05;
      material.needsUpdate = true;
      const curved = rig.getObjectByName("face");
      if (curved) curved.visible = false;
      const head = rig.getObjectByName("head");
      if (head) {
        const plate = new THREE.CircleGeometry(0.064, 48);
        const points = plate.attributes.position;
        const skull = 0.12;
        for (let i = 0; i < points.count; i += 1) {
          const x = points.getX(i);
          const y = points.getY(i) - 0.01;
          const surface = Math.sqrt(Math.max(0.004, skull * skull - x * x - y * y));
          points.setXYZ(i, x, y, surface + 0.004);
        }
        plate.computeVertexNormals();
        material.polygonOffset = true;
        material.polygonOffsetFactor = -4;
        material.polygonOffsetUnits = -4;
        const card = new THREE.Mesh(plate, material);
        card.name = "face-card";
        card.position.set(0, 0, 0);
        card.renderOrder = 2;
        head.add(card);
      }
    }
    for (const name of ["eyeL", "eyeR", "lidL", "lidR", "jaw", "chin", "hairL", "hairR"]) {
      const part = rig.getObjectByName(name);
      if (part) part.visible = false;
    }
    const images = new Map<string, HTMLImageElement>();
    let requestedSrc = "";
    const clock = { playing: false, current: 0, duration: 0 };
    const stopClock = sharedAudioOutput.onClock((next) => {
      clock.playing = next.playing;
      clock.current = next.current;
      clock.duration = next.duration;
    });
    let frame = 0;
    let blinkUntil = 0;
    let nextBlink = performance.now() + 2400;
    let stopped = false;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const draw = (now: number) => {
      if (stopped) return;
      frame = requestAnimationFrame(draw);
      const session = readAvatarSession();
      const speech = speechFrame(session.presence, session.utterance, session.startedAt, clock, Date.now());
      const src = selectFaceSrc(character, session.presence, liveRef.current.expression ?? null, speech.viseme, speech.speaking);
      const shown = liveRef.current.faceSrc || src;
      if (shown !== requestedSrc && !images.has(shown)) {
        requestedSrc = shown;
        const image = new Image();
        image.onload = () => {
          images.set(shown, image);
        };
        image.onerror = () => liveRef.current.onFail();
        image.src = shown;
      }
      const plate = images.get(shown);
      const hold = (window as unknown as { __eveHold?: string }).__eveHold;
      const blink = hold === "blink" || (!reduced && session.presence !== "speaking" && now < blinkUntil) ? 1 : 0;
      if (faceCtx && plate) {
        const forcedGaze = (window as unknown as { __eveGaze?: string }).__eveGaze;
        const gaze = forcedGaze === "right" ? plate.width * 0.045 : forcedGaze === "left" ? -plate.width * 0.045 : forcedGaze === "center" || reduced ? 0 : Math.sin(now / 1700) * plate.width * 0.035;
        const sw = plate.width * 0.6;
        const sx = plate.width * 0.2 + gaze;
        const sy = plate.height * 0.18;
        const sh = plate.height * 0.52;
        const shiftX = -gaze / sw * 512;
        faceCtx.clearRect(0, 0, 512, 512);
        faceCtx.drawImage(plate, sx, sy, sw, sh, 0, 0, 512, 512);
        const mood = liveRef.current.expression ?? "";
        if (mood === "smiling" || mood === "laughing" || mood === "excited") liftMouth(faceCtx, 1, shiftX);
        if (mood === "concerned" || mood === "sad") liftMouth(faceCtx, -1, shiftX);
        const speaking = speech.speaking || mood === "speaking" || mood === "laughing" || mood === "excited";
        const open = speaking ? mouthOpen(speech.speaking ? speech.viseme : "aa") : mood === "surprised" ? 0.45 : 0;
        if (open > 0.05) openMouth(faceCtx, open, shiftX);
        faceCtx.save();
        faceCtx.globalCompositeOperation = "destination-in";
        faceCtx.fillStyle = "#ffffff";
        faceCtx.beginPath();
        faceCtx.ellipse(256, 248, 188, 220, 0, 0, Math.PI * 2);
        faceCtx.fill();
        faceCtx.restore();
        faceCtx.save();
        faceCtx.globalCompositeOperation = "destination-out";
        const fade = faceCtx.createRadialGradient(256, 248, 150, 256, 248, 210);
        fade.addColorStop(0, "rgba(0,0,0,0)");
        fade.addColorStop(1, "rgba(0,0,0,1)");
        faceCtx.fillStyle = fade;
        faceCtx.fillRect(0, 0, 512, 512);
        faceCtx.restore();
        if (blink > 0) coverEyes(faceCtx, shiftX);
        host.dataset.blink = blink > 0 ? "1" : "0";
        host.dataset.viseme = speech.speaking ? speech.viseme : mood === "speaking" || mood === "laughing" || mood === "excited" ? "aa" : "rest";
        host.dataset.gaze = gaze > 0 ? "right" : "left";
        faceTexture.needsUpdate = true;
      }
      const shot = cameraForFraming(liveRef.current.framing);
      camera.fov = shot.fov;
      camera.position.set(...shot.position);
      camera.lookAt(...shot.target);
      camera.updateProjectionMatrix();
      applyViseme(rig, speech.speaking ? speech.viseme : "rest");
      applyGaze(rig, now, reduced);
      applyIdle(rig, now, session.presence, reduced);
      const forcedYaw = (window as unknown as { __eveYaw?: number }).__eveYaw;
      if (typeof forcedYaw === "number") drag = forcedYaw;
      rig.rotation.y = drag;
      const plateMesh = rig.getObjectByName("face-card");
      if (plateMesh) plateMesh.visible = Math.cos(drag) > 0.45;
      host.dataset.facing = Math.abs(drag) < 0.2 ? "front" : "turned";
      host.dataset.framing = liveRef.current.framing;
      const projected = liveRef.current.projection;
      const projectionKey = projected ? `${projected.id}|${projected.sky}|${projected.label}` : "";
      if (projected && projectionKey !== shownProjection) {
        shownProjection = projectionKey;
        (backdrop.material as THREE.MeshBasicMaterial).color.set(projected.sky);
        renderer.setClearColor(projected.sky, 1);
        if (screenContext) {
          screenContext.fillStyle = projected.sky;
          screenContext.fillRect(0, 0, 256, 160);
          screenContext.fillStyle = projected.floor;
          screenContext.fillRect(0, 108, 256, 52);
          screenContext.fillStyle = "#f4efe8";
          screenContext.font = "20px sans-serif";
          screenContext.fillText(projected.label.slice(0, 18), 16, 46);
          screenContext.font = "13px sans-serif";
          screenContext.fillText("EVE's computer", 16, 74);
          screenTexture.needsUpdate = true;
        }
        host.dataset.projection = projected.id;
      }
      if (!reduced && session.presence !== "speaking" && now > nextBlink && now >= blinkUntil) {
        blinkUntil = now + 700;
        nextBlink = now + 2600 + Math.random() * 1800;
      }
      renderer.render(scene, camera);
    };
    let drag = 0;
    let pointer: number | null = null;
    const down = (event: PointerEvent) => {
      pointer = event.clientX;
      host.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (pointer == null) return;
      drag = Math.max(-1.1, Math.min(1.1, drag + (event.clientX - pointer) * 0.012));
      pointer = event.clientX;
    };
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", () => { pointer = null; });
    frame = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      stopClock();
      observer.disconnect();
      faceTexture.dispose();
      rig.traverse((obj) => {
        const item = obj as THREE.Mesh;
        item.geometry?.dispose?.();
        const material = item.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose?.();
      });
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [characterId]);

  return <div ref={hostRef} className="human-stage" data-testid="human-stage" />;
}
