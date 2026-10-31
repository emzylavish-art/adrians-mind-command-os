import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { serverHalted } from "./execution-gate";
import { interpretDoctor, interpretInspect, REA_PACKAGE, type ReaRun } from "./rea-result";

export { interpretDoctor, interpretInspect, REA_PACKAGE };

function runRea(args: string[], timeout = 90000) {
  return new Promise<ReaRun>((resolve) => {
    execFile(
      "npx",
      ["-y", REA_PACKAGE, ...args],
      { timeout, maxBuffer: 4_000_000 },
      (error, stdout, stderr) => {
        const code = error && typeof error === "object" && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr).slice(0, 1500) });
      },
    );
  });
}

export const reaDoctor = createServerFn({ method: "POST" }).handler(async () => {
  const result = await runRea(["doctor", "--format", "json"]);
  return interpretDoctor(result);
});

export const reaInspect = createServerFn({ method: "POST" })
  .validator((input: { name: string; text: string }) => input)
  .handler(async ({ data }) => {
    if (serverHalted()) return { ok: false as const, error: "Emergency stop is on. Inspection is blocked." };
    const text = data.text.trim().slice(0, 40000);
    if (!text) return { ok: false as const, error: "There is no file text to inspect." };
    const dir = await mkdtemp(join(tmpdir(), "mind-rea-"));
    const safe = data.name.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 48) || "note.txt";
    const path = join(dir, safe.endsWith(".txt") ? safe : `${safe}.txt`);
    try {
      await writeFile(path, text);
      const result = await runRea(["inspect-artifact", path, "--format", "json"]);
      return interpretInspect(result);
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message.slice(0, 400) : "REA inspect failed." };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
