#!/usr/bin/env node
import { spawn } from "node:child_process";
import { discoverTests, repositoryRoot, selectShard } from "./test-inventory.mjs";
const shard = Number(process.argv[2]);
const count = Number(process.argv[3]);
const allFiles = discoverTests(repositoryRoot, "typed");
let selected;
try { selected = selectShard(allFiles, shard, count); }
catch (error) { console.error(error.message); process.exit(2); }
if (!selected.length) { console.error("No tests assigned to shard " + shard); process.exit(2); }
console.log(JSON.stringify({ shard, count, total: allFiles.length, selected: selected.length }));
const runner = spawn(process.execPath, ["--experimental-strip-types", "--test", `--test-concurrency=${Math.max(1, Math.min(4, Number(process.env.MIND_TEST_CONCURRENCY) || 4))}`, ...selected], { cwd: repositoryRoot, stdio: "inherit", shell: false });
runner.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
runner.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
