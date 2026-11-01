import * as THREE from "three";
import { paperHash } from "./paper-grain.ts";

export type NebulaTextureOptions = {
  size?: number;
  seed?: number;
};

/** Procedural painted nebula canvas texture (no external images). */
export function createNebulaTexture(opts: NebulaTextureOptions = {}): THREE.CanvasTexture {
  const size = opts.size ?? 512;
  const seed = opts.seed ?? 3;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#050814";
  ctx.fillRect(0, 0, size, size);
  const rand = (n: number) => paperHash(n, seed);
  for (let i = 0; i < 44; i++) {
    const x = rand(i) * size;
    const y = rand(i + 40) * size;
    const r = 36 + rand(i + 80) * 130;
    const hue = 210 + rand(i + 120) * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},72%,55%,0.30)`);
    g.addColorStop(0.5, `hsla(${hue + 28},58%,38%,0.12)`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand(i) - 0.5) * 16;
    img.data[i] = Math.min(255, Math.max(0, img.data[i]! + n));
    img.data[i + 1] = Math.min(255, Math.max(0, img.data[i + 1]! + n));
    img.data[i + 2] = Math.min(255, Math.max(0, img.data[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createNebulaSkyMaterial(opts: NebulaTextureOptions = {}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: createNebulaTexture(opts),
    side: THREE.BackSide,
    depthWrite: false,
  });
}
