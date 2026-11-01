import { execFileSync } from "node:child_process";

export type LandingHop =
  | "fleet-branch"
  | "dashboard-3d"
  | "preview/integration"
  | "main";

export type HopState = {
  hop: LandingHop;
  ref: string;
  sha: string | null;
  reached: boolean;
  note: string;
};

export type FleetLandingStatus = {
  lane: "painter" | "light" | "motion";
  botId: string;
  branch: string;
  remoteOk: boolean;
  remoteUrl: string;
  expectedRemoteIncludes: string;
  tipSha: string | null;
  hops: HopState[];
  mergedIntoDashboard3d: boolean;
  mergedIntoPreviewIntegration: boolean;
  mergedIntoMain: boolean;
  mergeGate: {
    watching: boolean;
    note: string;
  };
};

function runGit(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    timeout: 12_000,
    maxBuffer: 2 * 1024 * 1024,
  }).trim();
}

export function remoteLooksLikeMindOs(url: string): boolean {
  return /emzylavish-art\/adrians-mind-command-os(?:\.git)?$/i.test(url.replace(/\.git$/, ""))
    || /github\.com[:/]emzylavish-art\/adrians-mind-command-os/i.test(url);
}

/** Pure: decide hop reached flags from tip ancestry set. */
export function computeHopReach(input: {
  tipSha: string | null;
  dashboard3dSha: string | null;
  previewSha: string | null;
  mainSha: string | null;
  tipIsAncestorOfDashboard: boolean;
  tipIsAncestorOfPreview: boolean;
  tipIsAncestorOfMain: boolean;
}): { hops: HopState[]; mergedIntoDashboard3d: boolean; mergedIntoPreviewIntegration: boolean; mergedIntoMain: boolean } {
  const tip = input.tipSha;
  const fleetReached = Boolean(tip);
  const intoDash = input.tipIsAncestorOfDashboard;
  const intoPrev = input.tipIsAncestorOfPreview;
  const intoMain = input.tipIsAncestorOfMain;
  const hops: HopState[] = [
    {
      hop: "fleet-branch",
      ref: "fleet",
      sha: tip,
      reached: fleetReached,
      note: tip ? "Branch tip present" : "Branch tip missing",
    },
    {
      hop: "dashboard-3d",
      ref: "dashboard-3d",
      sha: input.dashboard3dSha,
      reached: intoDash,
      note: intoDash ? "Merged into dashboard-3d" : "Not merged to dashboard-3d",
    },
    {
      hop: "preview/integration",
      ref: "origin/preview/integration",
      sha: input.previewSha,
      reached: intoPrev,
      note: intoPrev ? "In preview/integration" : "Not merged to preview/integration",
    },
    {
      hop: "main",
      ref: "origin/main",
      sha: input.mainSha,
      reached: intoMain,
      note: intoMain ? "In main" : "not merged to main",
    },
  ];
  return {
    hops,
    mergedIntoDashboard3d: intoDash,
    mergedIntoPreviewIntegration: intoPrev,
    mergedIntoMain: intoMain,
  };
}

function revParse(repo: string, ref: string): string | null {
  try {
    return runGit(repo, ["rev-parse", "--short", ref]);
  } catch {
    return null;
  }
}

function isAncestor(repo: string, ancestor: string, descendant: string): boolean {
  try {
    runGit(repo, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

export function inspectFleetLanding(
  repo: string,
  lane: "painter" | "light" | "motion",
): FleetLandingStatus {
  const branch = `dashboard-3d-visual-${lane}`;
  const botId = lane === "painter" ? "cosmos-painter" : lane === "light" ? "cosmos-light" : "cosmos-motion";
  let remoteUrl = "";
  try {
    remoteUrl = runGit(repo, ["remote", "get-url", "origin"]);
  } catch {
    remoteUrl = "";
  }
  const remoteOk = remoteLooksLikeMindOs(remoteUrl);
  const tipSha =
    revParse(repo, `refs/heads/${branch}`) ||
    revParse(repo, `refs/remotes/origin/${branch}`);
  const dashSha = revParse(repo, "refs/heads/dashboard-3d") || revParse(repo, "refs/remotes/origin/dashboard-3d");
  const previewSha = revParse(repo, "refs/remotes/origin/preview/integration") || revParse(repo, "refs/heads/preview/integration");
  const mainSha = revParse(repo, "refs/remotes/origin/main") || revParse(repo, "refs/heads/main");

  const tipFull = tipSha ? (revParse(repo, tipSha) ? runGit(repo, ["rev-parse", tipSha]) : tipSha) : null;
  // Use branch names for ancestry when possible
  const tipRef = tipSha ? (`refs/remotes/origin/${branch}`) : "";
  const tryAncestor = (desc: string) => {
    if (!tipSha) return false;
    // Prefer named refs
    if (revParse(repo, `origin/${branch}`) || revParse(repo, branch)) {
      const anc = revParse(repo, `origin/${branch}`) ? `origin/${branch}` : branch;
      return isAncestor(repo, anc, desc);
    }
    return tipFull ? isAncestor(repo, tipFull, desc) : false;
  };

  const intoDash = tipSha && dashSha ? tryAncestor("dashboard-3d") || tryAncestor("origin/dashboard-3d") : false;
  const intoPrev = tipSha && previewSha ? tryAncestor("origin/preview/integration") || tryAncestor("preview/integration") : false;
  const intoMain = tipSha && mainSha ? tryAncestor("origin/main") || tryAncestor("main") : false;

  const computed = computeHopReach({
    tipSha,
    dashboard3dSha: dashSha,
    previewSha,
    mainSha,
    tipIsAncestorOfDashboard: intoDash,
    tipIsAncestorOfPreview: intoPrev,
    tipIsAncestorOfMain: intoMain,
  });

  return {
    lane,
    botId,
    branch,
    remoteOk,
    remoteUrl,
    expectedRemoteIncludes: "emzylavish-art/adrians-mind-command-os",
    tipSha,
    hops: computed.hops,
    mergedIntoDashboard3d: computed.mergedIntoDashboard3d,
    mergedIntoPreviewIntegration: computed.mergedIntoPreviewIntegration,
    mergedIntoMain: computed.mergedIntoMain,
    mergeGate: {
      watching: true,
      note: "Merge Gate Bot watches dashboard-3d (20-min cycle): moves into preview/integration only when dashboard-3d.lock is released; main only with Zack's approval.",
    },
  };
}

export function inspectAllFleetLandings(repo: string): FleetLandingStatus[] {
  return (["painter", "light", "motion"] as const).map((lane) => inspectFleetLanding(repo, lane));
}
