import * as THREE from "three";
import type { AvatarFraming } from "./presence.ts";
import type { VisemeId } from "./visemes.ts";

export type CharacterLook = {
  skin: string;
  hair: string;
  cloth: string;
  pants: string;
  shoes: string;
};

/** Original materials for the in-engine body. The face is the photographic plate. */
export const CHARACTER_LOOK: Record<string, CharacterLook> = {
  eve: { skin: "#8d5b45", hair: "#140e0c", cloth: "#2a2a2e", pants: "#141416", shoes: "#0c0c0e" },
  liora: { skin: "#c4a078", hair: "#6a3418", cloth: "#6f7d68", pants: "#2a2c28", shoes: "#1a1816" },
  iris: { skin: "#e0c2a8", hair: "#16141a", cloth: "#1d2c44", pants: "#1a1c22", shoes: "#101216" },
  luna: { skin: "#c4926a", hair: "#2a160e", cloth: "#d7cfc4", pants: "#3a342e", shoes: "#241c16" },
  aurora: { skin: "#6a3a2c", hair: "#120c0a", cloth: "#9a4a32", pants: "#1c1412", shoes: "#100c0a" },
};

export type CameraFrame = {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
};

export function cameraForFraming(framing: AvatarFraming): CameraFrame {
  switch (framing) {
    case "full":
      return { position: [0, 0.98, 2.35], target: [0, 0.92, 0], fov: 30 };
    case "face":
      return { position: [0, 1.58, 0.52], target: [0, 1.56, 0], fov: 26 };
    case "compact":
      return { position: [0, 1.52, 0.72], target: [0, 1.5, 0], fov: 28 };
    default:
      return { position: [0, 1.32, 1.15], target: [0, 1.28, 0], fov: 28 };
  }
}

export function jawOpenFor(viseme: VisemeId): number {
  switch (viseme) {
    case "aa":
      return 0.38;
    case "oo":
      return 0.26;
    case "ee":
      return 0.14;
    case "mm":
      return 0.05;
    default:
      return 0;
  }
}

function mat(color: string, roughness = 0.62): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

function mesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Mesh {
  const item = new THREE.Mesh(geometry, material);
  item.name = name;
  item.position.set(x, y, z);
  item.castShadow = true;
  parent.add(item);
  return item;
}

/**
 * Original humanoid. Not a downloaded GLB. The face mesh is a curved patch
 * meant to carry the character's photographic plate.
 */
export function createHumanRig(look: CharacterLook): THREE.Group {
  const rig = new THREE.Group();
  rig.name = "rig";
  const skin = mat(look.skin, 0.58);
  const hair = mat(look.hair, 0.72);
  const cloth = mat(look.cloth, 0.7);
  const pants = mat(look.pants, 0.74);
  const shoes = mat(look.shoes, 0.5);
  const eyeWhite = mat("#f3f0ea", 0.28);
  const pupil = mat("#1a120e", 0.35);

  const body = new THREE.Group();
  body.name = "body";
  rig.add(body);

  mesh("torso", new THREE.BoxGeometry(0.36, 0.46, 0.2), cloth, body, 0, 1.22, 0);
  mesh("pelvis", new THREE.BoxGeometry(0.3, 0.16, 0.18), pants, body, 0, 0.92, 0);
  mesh("thighL", new THREE.CapsuleGeometry(0.07, 0.28, 4, 8), pants, body, -0.09, 0.66, 0);
  mesh("thighR", new THREE.CapsuleGeometry(0.07, 0.28, 4, 8), pants, body, 0.09, 0.66, 0);
  mesh("calfL", new THREE.CapsuleGeometry(0.055, 0.26, 4, 8), pants, body, -0.09, 0.32, 0);
  mesh("calfR", new THREE.CapsuleGeometry(0.055, 0.26, 4, 8), pants, body, 0.09, 0.32, 0);
  mesh("shoeL", new THREE.BoxGeometry(0.09, 0.06, 0.18), shoes, body, -0.09, 0.04, 0.03);
  mesh("shoeR", new THREE.BoxGeometry(0.09, 0.06, 0.18), shoes, body, 0.09, 0.04, 0.03);

  const armL = mesh("armL", new THREE.CapsuleGeometry(0.045, 0.22, 4, 8), cloth, body, -0.24, 1.28, 0);
  armL.rotation.z = 0.18;
  const armR = mesh("armR", new THREE.CapsuleGeometry(0.045, 0.22, 4, 8), cloth, body, 0.24, 1.28, 0);
  armR.rotation.z = -0.18;
  mesh("foreL", new THREE.CapsuleGeometry(0.04, 0.2, 4, 8), skin, body, -0.28, 1.02, 0.02);
  mesh("foreR", new THREE.CapsuleGeometry(0.04, 0.2, 4, 8), skin, body, 0.28, 1.02, 0.02);
  mesh("handL", new THREE.SphereGeometry(0.04, 12, 10), skin, body, -0.28, 0.86, 0.03);
  mesh("handR", new THREE.SphereGeometry(0.04, 12, 10), skin, body, 0.28, 0.86, 0.03);

  mesh("neck", new THREE.CylinderGeometry(0.045, 0.05, 0.1, 12), skin, body, 0, 1.5, 0);

  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 1.6, 0);
  body.add(head);

  mesh("cranium", new THREE.SphereGeometry(0.12, 24, 18), skin, head, 0, 0, 0);
  const hairCap = mesh("hair", new THREE.SphereGeometry(0.125, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, head, 0, 0.02, -0.01);
  hairCap.scale.set(1, 1, 1.05);

  const faceMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5, metalness: 0 });
  faceMat.name = "face";
  const face = mesh(
    "face",
    new THREE.SphereGeometry(0.121, 32, 24, -0.7, 1.4, 0.45, 1.15),
    faceMat,
    head,
    0,
    -0.005,
    0.012,
  );
  face.scale.set(1, 1.05, 1);

  const eyeL = new THREE.Group();
  eyeL.name = "eyeL";
  eyeL.position.set(-0.04, 0.02, 0.09);
  head.add(eyeL);
  mesh("eyeWhiteL", new THREE.SphereGeometry(0.016, 12, 10), eyeWhite, eyeL, 0, 0, 0);
  mesh("pupilL", new THREE.SphereGeometry(0.007, 10, 8), pupil, eyeL, 0, 0, 0.012);

  const eyeR = new THREE.Group();
  eyeR.name = "eyeR";
  eyeR.position.set(0.04, 0.02, 0.09);
  head.add(eyeR);
  mesh("eyeWhiteR", new THREE.SphereGeometry(0.016, 12, 10), eyeWhite, eyeR, 0, 0, 0);
  mesh("pupilR", new THREE.SphereGeometry(0.007, 10, 8), pupil, eyeR, 0, 0, 0.012);

  const lidMat = mat(look.skin, 0.6);
  const lidL = mesh("lidL", new THREE.SphereGeometry(0.02, 10, 8), lidMat, head, -0.04, 0.032, 0.095);
  lidL.scale.set(1.3, 0.22, 0.45);
  const lidR = mesh("lidR", new THREE.SphereGeometry(0.02, 10, 8), lidMat, head, 0.04, 0.032, 0.095);
  lidR.scale.set(1.3, 0.22, 0.45);

  const jaw = new THREE.Group();
  jaw.name = "jaw";
  jaw.position.set(0, -0.035, 0.04);
  head.add(jaw);
  mesh("chin", new THREE.BoxGeometry(0.055, 0.03, 0.04), skin, jaw, 0, -0.02, 0.03);

  return rig;
}

export function faceMaterial(rig: THREE.Object3D): THREE.MeshStandardMaterial | null {
  const face = rig.getObjectByName("face");
  if (!(face instanceof THREE.Mesh)) return null;
  const material = face.material;
  return material instanceof THREE.MeshStandardMaterial ? material : null;
}

export function applyViseme(rig: THREE.Object3D, viseme: VisemeId): void {
  const jaw = rig.getObjectByName("jaw");
  if (!jaw) return;
  jaw.rotation.x = -jawOpenFor(viseme);
}

export function applyBlink(rig: THREE.Object3D, closed: number): void {
  const amount = Math.min(1, Math.max(0, closed));
  for (const name of ["lidL", "lidR"]) {
    const lid = rig.getObjectByName(name);
    if (!lid) continue;
    lid.scale.y = 0.22 + amount * 0.9;
    lid.position.y = 0.032 - amount * 0.012;
  }
}

export function applyGaze(rig: THREE.Object3D, timeMs: number, reduced: boolean): void {
  const yaw = reduced ? 0 : Math.sin(timeMs / 1700) * 0.35;
  const pitch = reduced ? 0 : Math.sin(timeMs / 2200) * 0.12;
  for (const name of ["eyeL", "eyeR"]) {
    const eye = rig.getObjectByName(name);
    if (!eye) continue;
    eye.rotation.y = yaw;
    eye.rotation.x = pitch;
  }
}

export function applyIdle(rig: THREE.Object3D, timeMs: number, presence: string, reduced: boolean): void {
  const head = rig.getObjectByName("head");
  const torso = rig.getObjectByName("torso");
  if (reduced) {
    if (head) head.rotation.set(0, 0, 0);
    if (torso) torso.scale.y = 1;
    return;
  }
  const listening = presence === "listening";
  const speaking = presence === "speaking";
  if (head) {
    head.rotation.y = Math.sin(timeMs / 1600) * (speaking ? 0.04 : 0.09);
    head.rotation.x = Math.sin(timeMs / 1900) * 0.04 + (listening ? 0.06 : 0);
    head.rotation.z = listening ? 0.05 : Math.sin(timeMs / 2400) * 0.02;
  }
  if (torso) {
    torso.scale.y = 1 + Math.sin(timeMs / 900) * 0.012;
  }
}

export function frameFaceTexture(texture: THREE.Texture): THREE.Texture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(0.58, 0.46);
  texture.offset.set(0.21, 0.34);
  texture.needsUpdate = true;
  return texture;
}
