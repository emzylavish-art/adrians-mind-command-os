import { useEffect, useRef } from "react";
import * as THREE from "three";
import { characterById } from "@/lib/mind/characters";
import type { AvatarExpression, AvatarFraming } from "@/lib/mind/avatar/presence";
import { readAvatarSession } from "@/lib/mind/avatar/session";
import { sharedAudioOutput } from "@/lib/mind/voice/audio-output";
import { selectFaceSrc, speechFrame } from "@/lib/mind/avatar/face-src";
import {
  CHARACTER_LOOK,
  applyGaze,
  applyIdle,
  applyViseme,
  cameraForFraming,
  createHumanRig,
  faceMaterial,
} from "@/lib/mind/avatar/human-rig";

export function HumanStage({
  characterId,
  framing,
  expression,
  onFail,
}: {
  characterId: string;
  framing: AvatarFraming;
  expression?: AvatarExpression | null;
  onFail: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const liveRef = useRef({ framing, expression, onFail });
  liveRef.current = { framing, expression, onFail };

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

    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
    const faceCanvas = document.createElement("canvas");
    faceCanvas.width = 512;
    faceCanvas.height = 512;
    const faceCtx = faceCanvas.getContext("2d");
    const faceTexture = new THREE.CanvasTexture(faceCanvas);
    faceTexture.colorSpace = THREE.SRGBColorSpace;
    faceTexture.wrapS = THREE.ClampToEdgeWrapping;
    faceTexture.wrapT = THREE.ClampToEdgeWrapping;
    const material = faceMaterial(rig);
    if (material && faceCtx) {
      material.map = faceTexture;
      material.needsUpdate = true;
    }
    for (const name of ["eyeL", "eyeR", "lidL", "lidR"]) {
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
      if (src !== requestedSrc && !images.has(src)) {
        requestedSrc = src;
        const image = new Image();
        image.onload = () => {
          images.set(src, image);
        };
        image.onerror = () => liveRef.current.onFail();
        image.src = src;
      }
      const plate = images.get(src);
      const blink = !reduced && session.presence !== "speaking" && now < blinkUntil ? 1 : 0;
      if (faceCtx && plate) {
        const gaze = reduced ? 0 : Math.sin(now / 1700) * plate.width * 0.012;
        const sx = plate.width * 0.2 + gaze;
        const sy = plate.height * 0.18;
        const sw = plate.width * 0.6;
        const sh = plate.height * 0.52;
        faceCtx.clearRect(0, 0, 512, 512);
        faceCtx.drawImage(plate, sx, sy, sw, sh, 0, 0, 512, 512);
        if (blink > 0) {
          faceCtx.fillStyle = "rgba(92, 58, 44, 0.92)";
          faceCtx.beginPath();
          faceCtx.ellipse(188, 230, 46, 16, 0, 0, Math.PI * 2);
          faceCtx.ellipse(324, 230, 46, 16, 0, 0, Math.PI * 2);
          faceCtx.fill();
        }
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
      if (!reduced && session.presence !== "speaking" && now > nextBlink && now >= blinkUntil) {
        blinkUntil = now + 140;
        nextBlink = now + 2600 + Math.random() * 1800;
      }
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
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

  return <div ref={hostRef} className="relative aspect-[3/4] w-full bg-[#101014]" data-testid="human-stage" />;
}
