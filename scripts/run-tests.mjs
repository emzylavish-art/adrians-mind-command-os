#!/usr/bin/env node
import { spawn } from "node:child_process";
import { discoverTests, repositoryRoot } from "./test-inventory.mjs";

const files = discoverTests();
console.log(JSON.stringify({ inventory: "all deterministic tests", total: files.length }));
const child = spawn(process.execPath, ["--experimental-strip-types", "--test", `--test-concurrency=${Math.max(1, Math.min(4, Number(process.env.MIND_TEST_CONCURRENCY) || 4))}`, ...files], { cwd: repositoryRoot, stdio: "inherit", shell: false });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
