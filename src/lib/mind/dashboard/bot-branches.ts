/**
 * Map dashboard bots → real git branches (locks + known lane names).
 * Never invents SHAs — only names where we actually look for git log.
 */
import type { DashboardBotId } from "./types.ts";

/** Canonical origin branches per bot (lane ownership). */
export const KNOWN_BOT_BRANCHES: Record<DashboardBotId, readonly string[]> = {
  "grok-build": ["preview/integration", "integration"],
  conductor: ["conductor"],
  "gap-dispatcher": ["gap-dispatcher", "gap"],
  "rea-feature-hunter": ["rea-feature-hunter", "rea"],
  "merge-gate": ["merge-gate"],
  "visual-polish": ["visual-polish", "visual/evolution-loop", "visual/blueprint-repair"],
  logic: ["logic-wiring", "logic"],
  "mcp-integration": ["mcp-integration"],
  "media-integration": ["media-integration"],
  "voice-integration": ["voice-integration"],
  "voice-wiring": ["voice-wiring"],
  "error-banners": ["error-banners"],
  "xai-verification": ["xai-verification", "xai"],
  "hp-pairing": ["hp-pairing", "pc-pairing"],
  dashboard: ["dashboard-3d"],
  "cosmos-painter": ["dashboard-3d-visual-painter"],
  "cosmos-light": ["dashboard-3d-visual-light"],
  "cosmos-motion": ["dashboard-3d-visual-motion"],
};

/** Reject control chars, path tricks, and absurd lengths before git sees them. */
export function sanitizeGitBranchName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let b = raw.trim().replace(/^refs\/(heads|remotes\/origin)\//, "").replace(/^origin\//, "");
  if (!b) return null;
  if (b.length > 200) return null;
  // Control chars / DEL / NUL
  if (/[\u0000-\u001f\u007f]/.test(b)) return null;
  if (b.includes("..") || b.includes("\\") || b.includes(" ")) return null;
  if (b.startsWith("-") || b.startsWith("/") || b.endsWith("/")) return null;
  // Allow common branch charset only
  if (!/^[A-Za-z0-9._/@+-]+$/.test(b)) return null;
  return b;
}

/** Lock branch (if clean) + known lane branches, de-duped, order preserved. */
export function branchesForBot(
  botId: DashboardBotId | string,
  lockBranch?: string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    const b = sanitizeGitBranchName(raw);
    if (!b || seen.has(b)) return;
    seen.add(b);
    out.push(b);
  };
  push(lockBranch);
  const known = KNOWN_BOT_BRANCHES[botId as DashboardBotId];
  if (known) for (const k of known) push(k);
  return out;
}

/** Exact branch match for commit ownership (no substring false positives). */
export function branchNamesEqual(a: string, b: string): boolean {
  const x = sanitizeGitBranchName(a);
  const y = sanitizeGitBranchName(b);
  return Boolean(x && y && x === y);
}

/** Union of every known bot branch (for a single bounded git collect). */
export function allKnownBotBranches(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of Object.values(KNOWN_BOT_BRANCHES)) {
    for (const b of list) {
      const s = sanitizeGitBranchName(b);
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}
