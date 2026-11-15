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
  eve: { skin: "#8d5b45", hair: "#140e0c", cloth: "#c4b8ae", pants: "#3d3538", shoes: "#1a1614" },
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
      return { position: [0, 0.96, 3.45], target: [0, 0.84, 0], fov: 28 };
    case "face":
      return { position: [0, 1.64, 1.15], target: [0, 1.62, 0.1], fov: 28 };
    case "compact":
      return { position: [0, 1.58, 1.35], target: [0, 1.55, 0.1], fov: 30 };
    default:
      return { position: [0, 1.2, 2.4], target: [0, 1.15, 0], fov: 28 };
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

/** Oval limb. A straight cylinder reads as a tube; this one tapers at the joint. */
function shapedLimb(points: Array<[number, number]>, squash = 0.78): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(points.map(([radius, y]) => new THREE.Vector2(radius, y)), 20);
  geo.scale(squash, 1, 1.08);
  geo.computeVertexNormals();
  return geo;
}

function shoeShape(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.04, 0.01);
  shape.lineTo(0.05, 0.01);
  shape.lineTo(0.055, 0.035);
  shape.quadraticCurveTo(0.02, 0.07, -0.03, 0.05);
  shape.lineTo(-0.04, 0.01);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1 });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0.03, 0.02);
  return geo;
}

function addFingers(hand: THREE.Mesh, skin: THREE.Material, side: -1 | 1) {
  for (const [index, x] of [-0.016, -0.005, 0.006, 0.016].entries()) {
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.028, 0.008), skin);
    finger.name = `finger-${side}-${index}`;
    finger.position.set(x, -0.05, 0.006);
    hand.add(finger);
  }
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.022, 0.01), skin);
  thumb.position.set(side * 0.028, -0.02, 0.012);
  thumb.rotation.z = side * -0.7;
  hand.add(thumb);
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
 * Fitted top over trousers. One lathe from collar to hip, then vertex-shaped
 * so the chest and seat are part of the cloth instead of stacked balls.
 * Idle may scale the torso group; the silhouette lives in this geometry.
 */
function clothedTorso(): THREE.BufferGeometry {
  const profile = [
    [0.042, 1.52],
    [0.062, 1.47],
    [0.098, 1.40],
    [0.132, 1.35],
    [0.140, 1.31],
    [0.134, 1.24],
    [0.122, 1.18],
    [0.096, 1.10],
    [0.078, 1.04],
    [0.108, 0.97],
    [0.162, 0.90],
    [0.210, 0.84],
    [0.200, 0.76],
    [0.200, 0.66],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(profile, 40);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    const y = pos.getY(i);
    let z = pos.getZ(i);
    const radial = Math.hypot(x, z) || 1;
    const front = Math.max(0, z / radial);
    const back = Math.max(0, -z / radial);
    if (y >= 0.78) z *= 0.82;
    if (y > 1.12 && y < 1.30) {
      const t = 1 - Math.abs(y - 1.21) / 0.09;
      const lobe = t * t;
      z += lobe * front * 0.045;
      x *= 1 + lobe * front * 0.02;
    }
    if (y > 1.00 && y < 1.10) z *= 0.94;
    if (y > 0.78 && y < 0.96) {
      const t = 1 - Math.abs(y - 0.86) / 0.09;
      z += t * back * 0.04;
      z += t * front * 0.02;
    }
    pos.setXYZ(i, x, y, z);
  }
  const hemY = 0.7;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.8) continue;
    const x = Math.max(-0.19, Math.min(0.19, pos.getX(i)));
    pos.setXYZ(i, x, y < hemY ? hemY : y, y < 0.76 ? 0.08 : pos.getZ(i));
  }
  geo.computeVertexNormals();
  return geo;
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

  const torso = new THREE.Group();
  torso.name = "torso";
  body.add(torso);

  const dress = mesh("dress", clothedTorso(), cloth, torso, 0, 0, 0);
  dress.castShadow = true;
  const hemShape = new THREE.Shape();
  hemShape.moveTo(-0.17, -0.12);
  hemShape.lineTo(0.17, -0.12);
  hemShape.quadraticCurveTo(0.21, -0.12, 0.21, -0.08);
  hemShape.lineTo(0.21, 0.14);
  hemShape.lineTo(-0.21, 0.14);
  hemShape.lineTo(-0.21, -0.08);
  hemShape.quadraticCurveTo(-0.21, -0.12, -0.17, -0.12);
  const hemGeo = new THREE.ExtrudeGeometry(hemShape, { depth: 0.18, bevelEnabled: false });
  hemGeo.translate(0, 0.74, -0.05);
  const hemFill = mesh("hem-fill", hemGeo, cloth, torso, 0, 0, 0);
  hemFill.castShadow = true;
  const collar = mesh("collar", new THREE.CylinderGeometry(0.045, 0.07, 0.08, 16), cloth, torso, 0, 1.5, 0);
  collar.castShadow = true;
  // Hidden proportion markers. The dress, not these spheres, is the silhouette.
  mesh("bust", new THREE.SphereGeometry(0.05, 10, 8), cloth, torso, 0, 1.21, 0.06);
  mesh("waist", new THREE.SphereGeometry(0.09, 12, 8), cloth, torso, 0, 1.04, 0);
  mesh("hips", new THREE.SphereGeometry(0.2, 14, 10), pants, torso, 0, 0.86, 0);
  mesh("shoulderL", new THREE.SphereGeometry(0.02, 8, 6), cloth, torso, -0.14, 1.34, 0);
  mesh("shoulderR", new THREE.SphereGeometry(0.02, 8, 6), cloth, torso, 0.14, 1.34, 0);
  for (const hidden of ["bust", "waist", "hips", "shoulderL", "shoulderR"]) {
    const part = torso.getObjectByName(hidden);
    if (part) part.visible = false;
  }

  const neck = mesh("neck", new THREE.CylinderGeometry(0.038, 0.046, 0.14, 16), skin, body, 0, 1.54, 0.02);
  neck.castShadow = true;

  const upperArm = shapedLimb([[0.058, 0.18], [0.046, 0.08], [0.038, -0.02], [0.03, -0.18]]);
  const forearm = shapedLimb([[0.032, 0.16], [0.026, 0.04], [0.02, -0.16]], 0.74);
  const thighShape = new THREE.CylinderGeometry(0.055, 0.055, 0.38, 16);
  const calfShape = new THREE.CylinderGeometry(0.055, 0.055, 0.32, 16);
  const armL = mesh("armL", upperArm, cloth, torso, -0.155, 1.28, 0.02);
  armL.rotation.z = -0.12;
  const armR = mesh("armR", upperArm.clone(), cloth, torso, 0.155, 1.28, 0.02);
  armR.rotation.z = 0.12;
  const foreL = mesh("foreL", forearm, cloth, armL, 0, -0.32, 0.01);
  const foreR = mesh("foreR", forearm.clone(), cloth, armR, 0, -0.32, 0.01);
  foreL.rotation.x = 0.22;
  foreR.rotation.x = 0.22;
  const handL = mesh("handL", new THREE.BoxGeometry(0.05, 0.07, 0.02), skin, foreL, 0, -0.2, 0.012);
  const handR = mesh("handR", new THREE.BoxGeometry(0.05, 0.07, 0.02), skin, foreR, 0, -0.2, 0.012);
  addFingers(handL, skin, -1);
  addFingers(handR, skin, 1);
  const thighL = mesh("thighL", thighShape, pants, torso, -0.09, 0.66, 0.015);
  const thighR = mesh("thighR", thighShape.clone(), pants, torso, 0.09, 0.66, 0.015);
  const calfL = mesh("calfL", calfShape, pants, thighL, 0, -0.32, 0);
  const calfR = mesh("calfR", calfShape.clone(), pants, thighR, 0, -0.32, 0);
  calfL.rotation.x = 0;
  calfR.rotation.x = 0;
  mesh("shoeL", shoeShape(), shoes, calfL, 0, -0.2, 0.03);
  mesh("shoeR", shoeShape(), shoes, calfR, 0, -0.2, 0.03);

  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 1.58, 0);
  body.add(head);

  mesh("cranium", new THREE.SphereGeometry(0.12, 24, 18), skin, head, 0, 0, 0);
  const hairCap = mesh("hair", new THREE.SphereGeometry(0.09, 24, 16), hair, head, 0, 0.075, -0.015);
  hairCap.scale.set(1.05, 0.72, 0.95);
  mesh("hairL", new THREE.SphereGeometry(0.04, 12, 10), hair, head, -0.1, -0.02, -0.05).scale.set(0.6, 1.3, 0.5);
  mesh("hairR", new THREE.SphereGeometry(0.04, 12, 10), hair, head, 0.1, -0.02, -0.05).scale.set(0.6, 1.3, 0.5);

  const faceMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5, metalness: 0 });
  faceMat.name = "face";
  const face = mesh(
    "face",
    new THREE.SphereGeometry(0.121, 32, 24, Math.PI / 2 - 0.7, 1.4, 0.42, 1.2),
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
