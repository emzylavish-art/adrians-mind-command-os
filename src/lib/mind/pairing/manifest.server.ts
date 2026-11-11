import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashContent, signAgentManifest } from "./integrity.ts";

const AGENT_FILES = ["MindAgent.ps1", "Emergency-Stop.ps1", "KimiAcpClient.mjs", "Install-MindAgent.ps1", "Uninstall-MindAgent.ps1"] as const;

export function buildSignedAgentManifest(repoRoot = process.cwd()) {
  const files: Record<string, string> = {};
  for (const name of AGENT_FILES) {
    const path = join(repoRoot, "agent", "windows", name);
    try {
      files[name] = hashContent(readFileSync(path));
    } catch {
      return { ok: false as const, error: `Missing agent file: ${name}` };
    }
  }
  return signAgentManifest(files, "1");
}
