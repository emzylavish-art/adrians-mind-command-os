import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyToolEvent,
  agentActivityFromTimeline,
  attachAuditIds,
  connectedServicesRail,
  elapsedMs,
  foldToolEvents,
  formatElapsed,
  systemStatusRail,
  timelineCounts,
} from "./tools-timeline.ts";
import type { TimedToolEvent } from "./tools-timeline.ts";

describe("tools timeline", () => {
  it("counts done/total and elapsed from real event times", () => {
    const events: TimedToolEvent[] = [
      { id: "r1", toolId: "list_projects", status: "running", text: "Running list_projects.", atMs: 1000 },
      { id: "d1", toolId: "list_projects", status: "completed", text: "Harbor", atMs: 1300 },
      { id: "r2", toolId: "search_notes", status: "running", text: "Running search_notes.", atMs: 1300 },
      { id: "d2", toolId: "search_notes", status: "failed", text: "No notes matched.", atMs: 1800 },
    ];
    const rows = foldToolEvents(events);
    const counts = timelineCounts(rows);
    assert.equal(counts.total, 2);
    assert.equal(counts.done, 2);
    assert.equal(counts.failed, true);
    assert.equal(counts.running, false);
    assert.equal(elapsedMs(rows[0], 2000), 300);
    assert.equal(formatElapsed(300), "300ms");
    assert.equal(formatElapsed(2300), "2.3s");
  });

  it("keeps a live running row until a terminal event arrives", () => {
    let rows = applyToolEvent([], { id: "r1", toolId: "list_chats", status: "running", text: "Running", atMs: 10 });
    assert.equal(timelineCounts(rows).running, true);
    assert.equal(timelineCounts(rows).done, 0);
    rows = applyToolEvent(rows, { id: "d1", toolId: "list_chats", status: "completed", text: "ok", atMs: 40 });
    assert.equal(timelineCounts(rows).done, 1);
    assert.equal(elapsedMs(rows[0], 40), 30);
  });

  it("attaches audit ids for View links and drives live activity percent from completed steps", () => {
    const rows = attachAuditIds(
      foldToolEvents([
        { id: "r1", toolId: "list_projects", status: "running", text: "Running", atMs: 0 },
        { id: "d1", toolId: "list_projects", status: "completed", text: "ok", atMs: 5 },
        { id: "r2", toolId: "list_chats", status: "running", text: "Running", atMs: 5 },
      ]),
      { list_projects: "audit-a", list_chats: "audit-b" },
    );
    assert.equal(rows[0].auditId, "audit-a");
    const live = agentActivityFromTimeline(rows);
    assert.equal(live.live, true);
    assert.equal(live.total, 2);
    assert.equal(live.step, 2);
    assert.equal(live.percent, 50);
  });

  it("marks failure on the timeline so a banner can follow", () => {
    const rows = foldToolEvents([
      { id: "r1", toolId: "notion", status: "running", text: "Running", atMs: 1 },
      { id: "d1", toolId: "notion", status: "failed", text: "Notion is not connected. Nothing was searched.", atMs: 2 },
    ]);
    assert.equal(timelineCounts(rows).failed, true);
    assert.equal(rows[0].status, "failed");
  });
});

describe("chat rail binding", () => {
  it("reports connected services from real config flags without inventing connections", () => {
    const services = connectedServicesRail({ grokConfigured: false, notionState: "unconfigured", mcpConnected: false });
    const grok = services.find((item) => item.name === "Grok");
    const local = services.find((item) => item.name === "Local computer");
    assert.equal(grok?.state, "Not configured");
    assert.equal(local?.state, "Not paired");
  });

  it("reports system status as configured or not configured only", () => {
    const status = systemStatusRail({
      grokConfigured: true,
      databaseConfigured: false,
      searchConfigured: false,
      signedIn: false,
    });
    assert.match(status.headline, /1\/4 configured/);
    assert.equal(status.rows.find((row) => row.name === "Grok key")?.state, "Configured");
    assert.equal(status.rows.find((row) => row.name === "Database URL")?.state, "Not configured");
  });
});
