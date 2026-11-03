/**
 * Auto-discover one-file adapters from adapters/*.ts|js.
 * Path traversal in adapter name is rejected.
 */
import { readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AdapterFactory, VoiceProviderAdapter } from "../adapter-interface.ts";

const SAFE_ID = /^[a-z][a-z0-9_-]{0,63}$/;

export function assertSafeAdapterId(id: string): void {
  if (!SAFE_ID.test(id)) {
    throw new Error(`Unsafe adapter id ${JSON.stringify(id)}. Use lowercase [a-z0-9_-] only.`);
  }
  if (id.includes("..") || id.includes("/") || id.includes("\\")) {
    throw new Error("Adapter id path traversal rejected.");
  }
}

export async function loadAdaptersFromDir(
  dir: string,
  env: Record<string, string | undefined> = process.env,
): Promise<Map<string, VoiceProviderAdapter>> {
  const out = new Map<string, VoiceProviderAdapter>();
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return out;
  }
  for (const file of files) {
    const ext = extname(file);
    if (![".ts", ".js", ".mjs"].includes(ext)) continue;
    if (file.startsWith("_") || file.endsWith(".test.ts") || file.endsWith(".d.ts")) continue;
    const id = basename(file, ext);
    try {
      assertSafeAdapterId(id);
    } catch {
      continue; // skip malformed filenames rather than crashing hub boot
    }
    const full = join(dir, file);
    // Prevent path escape: resolved basename must equal id
    if (basename(full, ext) !== id) continue;
    try {
      const mod = await import(pathToFileURL(full).href);
      const factory: AdapterFactory | undefined =
        typeof mod.createAdapter === "function"
          ? mod.createAdapter
          : typeof mod.default === "function"
            ? mod.default
            : undefined;
      const ready: VoiceProviderAdapter | undefined =
        factory ? factory(env) : (mod.adapter as VoiceProviderAdapter | undefined);
      if (!ready || typeof ready.health !== "function") continue;
      if (ready.id && ready.id !== id) {
        // Prefer filename id for registry stability
        (ready as { id: string }).id = id;
      }
      out.set(id, { ...ready, id });
    } catch (err) {
      // Malformed adapter file — skip, record as broken via placeholder
      out.set(id, {
        id,
        label: `${id} (failed to load)`,
        disabled: true,
        async health() {
          return {
            ok: false,
            status: "adapter_load_error",
            detail: err instanceof Error ? err.message : "Adapter failed to load",
            watermark: null,
            backend: id,
          };
        },
        async listVoices() {
          return [];
        },
        async createVoice() {
          throw new Error(`Adapter ${id} failed to load.`);
        },
        async synthesize() {
          throw new Error(`Adapter ${id} failed to load.`);
        },
        async deleteVoice() {
          return { deleted: false };
        },
      });
    }
  }
  return out;
}
