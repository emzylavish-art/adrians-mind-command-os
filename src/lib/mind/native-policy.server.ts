import { readFileSync } from "node:fs";

export type NativeNetworkPolicy = "local-only" | "connected-services";
/** Read on every dispatch so changing the desktop menu takes effect without restart. */
export function nativeNetworkPolicy(env: NodeJS.ProcessEnv = process.env): NativeNetworkPolicy | null {
  if (env.ADRIAN_PC !== "1" || env.VERCEL) return null;
  if (!env.ADRIAN_NATIVE_PREFERENCES) return "local-only";
  try {
    const value = JSON.parse(readFileSync(env.ADRIAN_NATIVE_PREFERENCES, "utf8"));
    return value.networkPolicy === "connected-services" ? "connected-services" : "local-only";
  } catch { return "local-only"; }
}
export function nativeCloudAllowed(env: NodeJS.ProcessEnv = process.env): boolean { return nativeNetworkPolicy(env) !== "local-only"; }
export function currentLocalDestination(env: NodeJS.ProcessEnv = process.env) {
  return { kind: "local" as const, deviceId: env.ADRIAN_DEVICE_ID || "current-device", enabled: env.ADRIAN_PC === "1" && !env.VERCEL, platform: process.platform, arch: process.arch, networkPolicy: nativeNetworkPolicy(env), pairedOnlineIsExecutionProof: false };
}
