import { DASHBOARD_BOTS } from "./bots.ts";
import type { DashboardStatus, TelemetryReceipt } from "./types.ts";

const PUBLIC_SOURCE_IDS = ["locks", "git", "commitsSnapshot", "transitions", "branchCommits", "timeline", "constellations", "edges", "weather", "projects", "fleetPlan", "skyFeed", "charts", "notionMirror"] as const;
const PRIVATE_SOURCE_IDS = ["notion", "conductor", "gapDispatcher", "spend", "money"] as const;
const safeText = (value: string | null | undefined, max = 300) => typeof value === "string" ? value.replace(/\p{Cc}/gu, " ").slice(0, max) : "";
const publicLockStatus = (value: string | null) => /\bblocked|error\b/i.test(value ?? "") ? "blocked" : /\bdone|released|completed\b/i.test(value ?? "") ? "released" : /\bclaimed|progress|active|working\b/i.test(value ?? "") ? "claimed" : "recorded";
const chart = (value: DashboardStatus["charts"]["botHealth"]) => ({
  id: value.id, title: value.title, unit: value.unit,
  points: value.points.map(point => ({ label: safeText(point.label), value: point.value })),
  source: value.points.length ? "Public development telemetry" : "unavailable", emptyReason: value.emptyReason,
});

/** Publication contract. Never spread a server object, including nested records.
 * Host paths, free-form lock/queue notes, account data and spend are owner-only.
 * A new internal field stays private until it is deliberately added here.
 */
export function toPublicDashboardStatus(status: DashboardStatus) {
  const telemetry: Record<string, TelemetryReceipt> = {};
  for (const id of PUBLIC_SOURCE_IDS) {
    const item = status.sources.telemetry?.[id];
    if (item) telemetry[id] = { outcome: item.outcome, basis: item.basis, collectedAt: item.collectedAt, updatedAt: item.updatedAt, freshness: item.freshness, count: item.count, ...(item.errorCode ? { errorCode: item.errorCode } : {}) };
  }
  for (const id of PRIVATE_SOURCE_IDS) telemetry[id] = { outcome: "private", basis: "private", collectedAt: status.generatedAt, updatedAt: null, freshness: "not_applicable", count: null, errorCode: "private_source" };
  const bots = status.bots.flatMap(bot => {
    const definition = DASHBOARD_BOTS.find(item => item.id === bot.id);
    if (!definition) return [];
    return [{ id: bot.id, name: definition.name, health: bot.health,
      lock: bot.lock ? { branch: bot.lock.branch, status: publicLockStatus(bot.lock.status), claimed_at: bot.lock.claimed_at, released_at: bot.lock.released_at, commits: bot.lock.commits.map(value => safeText(value)), notes: "" } : null,
      branch: bot.branch, lastActivityAt: bot.lastActivityAt, commits: bot.commits.map(value => safeText(value)), notes: "",
      reason: bot.lock ? `Development lock: ${publicLockStatus(bot.lock.status)}. Runtime readiness is unverified.` : "No development lock recorded. Runtime readiness is unverified.",
      healthBasis: "development" as const, runtimeHealth: "unverified" as const,
    }];
  });
  const emptyPrivate = "Private workspace information is available after sign-in.";
  return {
    generatedAt: status.generatedAt,
    bots,
    commits: status.commits.map(commit => ({ sha: commit.sha, subject: safeText(commit.subject), author: safeText(commit.author), date: commit.date, branch: commit.branch })),
    notion: { available: false as const, reason: emptyPrivate },
    conductor: { source: "private", nudges: [] },
    gapDispatcher: { source: "private", items: [] },
    orchestrator: { owner: null, status: status.orchestrator.status ? publicLockStatus(status.orchestrator.status) : null, branch: status.orchestrator.branch, claimed_at: status.orchestrator.claimed_at, notes: "", lockFile: null },
    spend: { available: false as const, reason: emptyPrivate },
    sources: { locksOk: status.sources.locksOk, gitOk: status.sources.gitOk, commitsSource: status.sources.commitsSource, commitsSnapshotAt: status.sources.commitsSnapshotAt, telemetry },
    constellations: status.constellations.map(lane => ({ id: lane.id, name: lane.name, botIds: lane.botIds.map(id => id), center: [lane.center[0], lane.center[1], lane.center[2]], health: lane.health })),
    constellationEdges: status.constellationEdges.map(edge => ({ from: edge.from, to: edge.to, kind: edge.kind, health: edge.health })),
    weather: { label: status.weather.label, tone: status.weather.tone, summary: status.weather.summary },
    notionGraph: { available: false, mode: "unavailable", reason: emptyPrivate, generatedAt: null, pages: [], edges: [], botPageMap: {}, stats: { pages: 0, edges: 0, botsMapped: 0 } },
    projects: { available: status.projects.available, reason: status.projects.available ? undefined : "Development projects unavailable.", generatedAt: status.projects.generatedAt,
      projects: status.projects.projects.filter(project => project.kind === "bot").map(project => ({
        id: project.id, name: project.name, kind: project.kind, progress: project.progress, progressKnown: project.progressKnown, openTasks: project.openTasks, doneTasks: project.doneTasks,
        tasks: project.tasks.map(task => ({ id: task.id, title: publicLockStatus(task.status), status: task.status, source: "Development lock" })),
        recentRuns: project.recentRuns.map(run => ({ id: run.id, label: safeText(run.label), at: run.at, ok: run.ok })),
        bots: project.bots.map(name => safeText(name)), lastActivityAt: project.lastActivityAt, health: project.health, notes: "", emptyReason: project.emptyReason ? "No development activity recorded." : undefined,
      })),
      agents: status.projects.agents.map(agent => ({ botId: agent.botId, name: agent.name, basis: "development" as const, runs: agent.runs, success: agent.success, failure: agent.failure, lastActive: agent.lastActive, health: agent.health, branch: agent.branch })),
    },
    fleetPlan: {
      fleetStars: status.fleetPlan.fleetStars.map(star => ({ botId: star.botId, lane: star.lane, name: star.name, health: star.health, lockFile: "", status: star.status ? publicLockStatus(star.status) : null, workingOn: "", paths: [], latestCommit: star.latestCommit, branch: star.branch })),
      landings: status.fleetPlan.landings.map(landing => ({ lane: landing.lane, botId: landing.botId, branch: landing.branch, remoteOk: landing.remoteOk, remoteUrl: "", expectedRemoteIncludes: "", tipSha: landing.tipSha,
        hops: landing.hops.map(hop => ({ hop: hop.hop, ref: hop.ref, sha: hop.sha, reached: hop.reached, note: hop.reached ? "Commit ancestry observed" : "Commit ancestry not established" })),
        mergedIntoDashboard3d: landing.mergedIntoDashboard3d, mergedIntoPreviewIntegration: landing.mergedIntoPreviewIntegration, mergedIntoMain: landing.mergedIntoMain,
        mergeGate: { watching: landing.mergeGate.watching, note: "" },
      })),
      queue: [], queueHead: null, mergeGateNote: "Private development notes are not published.",
    },
    timeline: { events: status.timeline.events.map(event => ({ atMs: event.atMs, atIso: event.atIso, kind: event.kind, botId: event.botId, branch: event.branch, sha: event.sha, subject: event.kind === "commit" ? safeText(event.subject) : undefined, label: event.kind === "commit" ? safeText(event.subject || event.label) : `${event.kind.replaceAll("_", " ")} observed` })), earliestMs: status.timeline.earliestMs, latestMs: status.timeline.latestMs, droppedFuture: status.timeline.droppedFuture, droppedInvalid: status.timeline.droppedInvalid, truncated: status.timeline.truncated },
    skyFeed: { events: [], list: [], sources: { conductor: "private", gap: "private", lock: "private", landing: "Development telemetry", commit: "Development telemetry", merge_gate: "private", notion_stop: "private" }, droppedFlood: 0, droppedStale: 0, droppedDupes: 0, generatedAtMs: status.skyFeed.generatedAtMs },
    money: { available: false, reason: emptyPrivate, source: null, currency: "USD", todayTotalUsd: null, burnPerHourUsd: null, warnings: [], asOfMs: null, eventCount: 0, stale: false, droppedInvalid: 0, todayKey: null },
    charts: { commitsPerBotHour: chart(status.charts.commitsPerBotHour), commitsPerDay: chart(status.charts.commitsPerDay), botHealth: chart(status.charts.botHealth), lockHealthShare: chart(status.charts.lockHealthShare), landingsPerLane: chart(status.charts.landingsPerLane), spend: { id: "spend", title: "Spend", unit: "USD", points: [], source: "private", emptyReason: emptyPrivate }, generatedAtMs: status.charts.generatedAtMs },
    notionMirror: { available: false, reason: telemetry.notionMirror?.outcome === "failed" ? "Notion mirror generation failed." : emptyPrivate, mode: "unavailable", generatedAt: null, rows: [], staleCount: 0, mappedCount: 0 },
  };
}
