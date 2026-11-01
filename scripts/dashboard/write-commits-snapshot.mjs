import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const out = execFileSync("git", ["-C", root, "log", "--all", "-n60", "--format=%h|%an|%aI|%D|%s"], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
});
const commits = [];
const seen = new Set();
for (const line of out.split("\n")) {
  if (!line.trim()) continue;
  const parts = line.split("|");
  if (parts.length < 5) continue;
  const [sha, author, date, deco] = parts;
  const subject = parts.slice(4).join("|");
  if (!sha || seen.has(sha)) continue;
  seen.add(sha);
  let branch = "unknown";
  for (const piece of deco.split(",").map((s) => s.trim())) {
    if (piece.startsWith("HEAD -> ")) {
      branch = piece.slice("HEAD -> ".length);
      break;
    }
    if (piece.startsWith("origin/")) {
      branch = piece.slice("origin/".length);
      break;
    }
    if (piece && !piece.startsWith("tag:") && !piece.includes("->")) {
      branch = piece;
    }
  }
  commits.push({ sha, author, date, branch, subject });
}
const snap = {
  generatedAt: new Date().toISOString(),
  timezoneNote: "Commit author dates are ISO from git; snapshot stamped UTC.",
  source: "git log --all",
  repoHint: "mind-command-os-dashboard worktree at snapshot time",
  commits,
};
const dests = [
  join(root, "src/lib/mind/dashboard/commits-snapshot.json"),
  join(root, "scripts/dashboard/commits-snapshot.json"),
];
for (const dest of dests) {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(snap, null, 2) + "\n");
  console.log("wrote", dest, "n=", commits.length);
}
