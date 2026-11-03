import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideResearchEscape,
  getActiveResearchSnapshot,
  queueResearchSteer,
  requestResearchAbort,
  setActiveResearchRun,
  setResearchReportOverlayOpen,
  takeResearchSteers,
} from "./active-research-run.ts";
import { onVoiceEndConfirmed, onVoiceMuteOrBargeIn, shouldAbortResearchOnVoiceEnd } from "./research-voice-end.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

describe("research-layer voice (N5)", () => {
  it("documents data-research-state Search|Deep|Running|Done on LiveSpeakControl", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const src = readFileSync(join(root, "src/components/mind/composer-live-voice.tsx"), "utf8");
    assert.match(src, /data-research-state=\{/);
    assert.match(src, /ResearchVoiceState/);
  });

  it("Esc closes report overlay without aborting Running (yields to modal)", () => {
    assert.equal(
      decideResearchEscape({
        key: "Escape",
        reportOverlayOpen: true,
        researchState: "Running",
        haltOn: false,
        topmostModalOpen: true,
      }).action,
      "yield_modal",
    );
    assert.equal(
      decideResearchEscape({
        key: "Escape",
        reportOverlayOpen: true,
        researchState: "Running",
        haltOn: false,
        topmostModalOpen: false,
      }).action,
      "close_overlay",
    );
    assert.equal(
      decideResearchEscape({
        key: "Escape",
        reportOverlayOpen: true,
        researchState: "Running",
        haltOn: true,
        topmostModalOpen: false,
      }).action,
      "abort_and_close",
    );
  });

  it("mute/barge-in never abort; End confirmed does", () => {
    setActiveResearchRun("r1", "Deep");
    assert.equal(onVoiceMuteOrBargeIn().abortedResearch, false);
    assert.equal(researchAbortRequestedFalse(), false);
    assert.equal(
      shouldAbortResearchOnVoiceEnd({ researchState: "Deep", userConfirmedEnd: false }),
      false,
    );
    assert.equal(onVoiceEndConfirmed().abortedResearch, true);
    assert.equal(getActiveResearchSnapshot().abortRequested, true);
    setActiveResearchRun(null);
  });

  it("queues final steers for an active run and rejects when idle", () => {
    setActiveResearchRun("r2", "Running");
    assert.equal(queueResearchSteer("focus on citations").ok, true);
    assert.deepEqual(takeResearchSteers(), ["focus on citations"]);
    setActiveResearchRun(null);
    assert.equal(queueResearchSteer("nope").ok, false);
  });

  it("halt abort flag can be set explicitly", () => {
    setActiveResearchRun("r3", "Running");
    setResearchReportOverlayOpen(true);
    requestResearchAbort("halt");
    assert.equal(getActiveResearchSnapshot().abortRequested, true);
    setResearchReportOverlayOpen(false);
    setActiveResearchRun(null);
  });
});

function researchAbortRequestedFalse() {
  return getActiveResearchSnapshot().abortRequested;
}
