import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpretDoctor, interpretInspect } from "./rea-result.ts";

const failedInspect = JSON.stringify({
  error: "Analysis failed",
  code: "target_unavailable",
  message: "Cannot open artifact: unsupported binary format.",
});

describe("REA result interpretation", () => {
  it("accepts an unhealthy doctor report without calling the environment ready", () => {
    const report = interpretDoctor({
      code: 1,
      stdout: JSON.stringify({
        healthy: false,
        identity: { cli_package_version: "6.8.0" },
        checks: [{ name: "node", ok: false, detail: "22.23.3", remediation: "Install 22.23.4+" }],
      }),
      stderr: "",
    });
    assert.equal(report.ok, true);
    if (!report.ok) return;
    assert.equal(report.healthy, false);
    assert.equal(report.version, "6.8.0");
    assert.equal(report.gaps[0]?.name, "node");
  });

  it("rejects a doctor response that is not JSON", () => {
    const report = interpretDoctor({ code: 1, stdout: "npm warn only", stderr: "boom" });
    assert.equal(report.ok, false);
  });

  it("rejects inspect output that has an error and no evidence", () => {
    const report = interpretInspect({ code: 1, stdout: failedInspect, stderr: "" });
    assert.equal(report.ok, false);
    if (report.ok) return;
    assert.match(report.error, /unsupported binary format/);
  });

  it("rejects inspect output that exits cleanly but has no evidence id", () => {
    const report = interpretInspect({ code: 0, stdout: JSON.stringify({ operation: "inspect_artifact" }), stderr: "" });
    assert.equal(report.ok, false);
  });

  it("accepts inspect output only when evidence exists and the command exited cleanly", () => {
    const report = interpretInspect({
      code: 0,
      stdout: JSON.stringify({
        evidence_id: "ev-1",
        operation: "inspect_artifact",
        subject: { format: "text", digest: { sha256: "abc" } },
        provider: { name: "REA" },
      }),
      stderr: "",
    });
    assert.equal(report.ok, true);
    if (!report.ok) return;
    assert.equal(report.evidenceId, "ev-1");
  });
});
