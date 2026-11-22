import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type GitHubTool = {
  id: string;
  repo: string;
  binary: string | null;
  gap: string;
};

export const GITHUB_TOOLS: readonly GitHubTool[] = [
  { id: "backup", repo: "https://github.com/restic/restic", binary: "restic", gap: "A restic snapshot is not a restore of the HP EliteBook." },
  { id: "cad", repo: "https://github.com/openscad/openscad", binary: "openscad", gap: "An STL export is not a manufacturer or a machine." },
  { id: "translation", repo: "https://github.com/LibreTranslate/LibreTranslate", binary: null, gap: "LibreTranslate is not installed. No text was translated." },
  { id: "bank", repo: "", binary: null, gap: "No GitHub repository is this owner's bank, card, or refund provider." },
  { id: "booking", repo: "", binary: null, gap: "No booking provider is connected." },
  { id: "identity-network", repo: "", binary: null, gap: "No external identity network was called." },
  { id: "marketplace", repo: "", binary: null, gap: "No agent marketplace was contacted." },
  { id: "headset", repo: "", binary: null, gap: "No headset answered. None was simulated." },
  { id: "sensor", repo: "", binary: null, gap: "No sensor returned a reading." },
  { id: "second-person", repo: "", binary: null, gap: "A second person was not contacted and was not invented." },
];

function which(name: string): boolean {
  try {
    execFileSync("bash", ["-lc", `command -v ${name}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function listGitHubTools(): string {
  return GITHUB_TOOLS.map((tool) => {
    const present = tool.binary ? which(tool.binary) : false;
    const source = tool.repo || "no repository substitutes for this";
    return `${tool.id}: ${present ? "binary present" : "not connected"} (${source}). ${tool.gap}`;
  }).join(" ");
}

export function backupWithRestic(root: string): string {
  if (!which("restic")) return "restic is not installed. Nothing was backed up. https://github.com/restic/restic";
  const work = path.join(root, "restic-work");
  const repo = path.join(work, "repo");
  const data = path.join(work, "data");
  mkdirSync(data, { recursive: true });
  const note = path.join(data, "note.txt");
  writeFileSync(note, "adrian-backup-check");
  const env = { ...process.env, RESTIC_PASSWORD: "local-test-only" };
  try {
    execFileSync("restic", ["init", "--repo", repo], { env, stdio: "pipe" });
    execFileSync("restic", ["backup", data, "--repo", repo], { env, stdio: "pipe" });
    const snaps = execFileSync("restic", ["snapshots", "--repo", repo, "--json"], { env, encoding: "utf8" });
    const count = JSON.parse(snaps).length;
    return `restic created ${count} snapshot in ${repo}. The HP EliteBook was not backed up.`;
  } catch {
    return "restic did not finish. Nothing was claimed as restored.";
  }
}

export function makeCubeWithOpenScad(root: string): string {
  if (!which("openscad")) return "OpenSCAD is not installed. No model was made. https://github.com/openscad/openscad";
  const dir = path.join(root, "openscad-work");
  mkdirSync(dir, { recursive: true });
  const scad = path.join(dir, "cube.scad");
  const stl = path.join(dir, "cube.stl");
  writeFileSync(scad, "cube([10,10,10]);\n");
  try {
    execFileSync("openscad", ["-o", stl, scad], { stdio: "pipe", timeout: 60_000 });
  } catch {
    return "OpenSCAD did not export a model. Nothing was sent to a manufacturer.";
  }
  if (!existsSync(stl) || readFileSync(stl).length < 20) return "OpenSCAD returned no STL. Nothing was invented.";
  return `OpenSCAD wrote ${stl}. No manufacturer was contacted.`;
}

export function runGitHubTool(text: string, root = path.join(os.tmpdir(), "adrian-tools")): string | null {
  const lower = text.trim().toLowerCase();
  if (lower === "list tools") return listGitHubTools();
  if (lower === "backup folder") return backupWithRestic(root);
  if (lower === "make model") return makeCubeWithOpenScad(root);
  if (lower.startsWith("translate ")) return "LibreTranslate is not installed. No text was translated. https://github.com/LibreTranslate/LibreTranslate";
  return null;
}
