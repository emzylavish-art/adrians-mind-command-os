import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/** Post-process: watercolor wash + paper grain + mild edge soft (no external textures). */
export const PainterlyPassShader = {
  name: "PainterlyPassShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    amount: { value: 0.42 },
    grain: { value: 0.09 },
    wash: { value: 0.38 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float amount;
    uniform float grain;
    uniform float wash;
    varying vec2 vUv;
    ${GLSL_HASH_NOISE}
    void main() {
      vec2 uv = vUv;
      float n = paintFbm(uv * 64.0 + time * 0.04);
      vec2 brush = (vec2(
        paintNoise(uv * 48.0 + vec2(time * 0.02, 0.0)),
        paintNoise(uv * 48.0 + vec2(0.0, 3.1))
      ) - 0.5) * amount * 0.014;
      vec4 c = texture2D(tDiffuse, uv + brush);
      vec4 blur = (
        texture2D(tDiffuse, uv + vec2( brush.x, 0.0)) +
        texture2D(tDiffuse, uv + vec2(-brush.x, 0.0)) +
        texture2D(tDiffuse, uv + vec2(0.0,  brush.y)) +
        texture2D(tDiffuse, uv + vec2(0.0, -brush.y))
      ) * 0.25;
      c.rgb = mix(c.rgb, blur.rgb, wash);
      // paper grain
      float g = (n - 0.5) * grain * amount;
      c.rgb += g;
      // watercolor edge darken / vignette
      float vig = smoothstep(1.15, 0.32, length(uv - 0.5));
      c.rgb *= mix(0.78, 1.0, vig);
      // slight pigment shift toward indigo wash
      c.rgb = mix(c.rgb, c.rgb * vec3(0.94, 0.96, 1.05), 0.12 * amount);
      gl_FragColor = c;
    }
  `,
};

export type PainterlyPassOptions = {
  amount?: number;
  grain?: number;
  wash?: number;
};

export function createPainterlyPass(opts: PainterlyPassOptions = {}): ShaderPass {
  const pass = new ShaderPass(PainterlyPassShader);
  if (opts.amount != null) pass.uniforms["amount"]!.value = opts.amount;
  if (opts.grain != null) pass.uniforms["grain"]!.value = opts.grain;
  if (opts.wash != null) pass.uniforms["wash"]!.value = opts.wash;
  return pass;
}

export function tickPainterlyPass(pass: ShaderPass, timeSeconds: number): void {
  if (pass.uniforms["time"]) pass.uniforms["time"].value = timeSeconds;
}
