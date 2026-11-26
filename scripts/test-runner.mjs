import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** One process and disposable temp directory per file. No global /tmp cleanup. */
export async function runDiscoveredTests(files) {
  const failed = [];
  for (const file of files) {
    const directory = mkdtempSync(join(tmpdir(), "mind-regression-"));
    console.log(`\nRegression file: ${file}`);
    try {
      const code = await new Promise((resolve) => {
        const child = spawn(process.execPath, ["--experimental-strip-types", "--test", "--test-isolation=none", "--test-reporter=spec", "--test-concurrency=1", file], {
          stdio: "inherit", shell: false,
          env: { ...process.env, NODE_TEST_CONTEXT: "mind-fixture", TMPDIR: directory },
        });
        child.on("error", (error) => { console.error(error.message); resolve(1); });
        child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
      });
      if (code !== 0) failed.push(file);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  console.log(JSON.stringify({ regressionFiles: files.length, passedFiles: files.length - failed.length, failedFiles: failed }));
  return failed.length ? 1 : 0;
}
