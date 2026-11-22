import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { reloadLocalCapabilities, runLocalCommand, setLocalCapabilityFile } from "./local-capabilities.ts";
import { inspectInformation, recordInformation } from "./frontier-2031.ts";

describe("blueprint surface", () => {
  it("records a task, a source, and an attempt without calling an outside service", () => {
    setLocalCapabilityFile(path.join(mkdtempSync(path.join(tmpdir(), "adrian-blueprint-")), "state.json"));
    assert.match(runLocalCommand("blueprint status") ?? "", /not verified/);
    assert.match(runLocalCommand("pack task compare reports") ?? "", /compare reports/);
    assert.match(runLocalCommand("register source report.txt owner owned text") ?? "", /not opened/);
    assert.match(runLocalCommand("note attempt research read the brief") ?? "", /not executed/);
    assert.match(runLocalCommand("office buy a ticket") ?? "", /not called/);
    assert.match(runLocalCommand("backup status") ?? "", /No restore ran/);
    reloadLocalCapabilities();
    assert.match(runLocalCommand("list tasks") ?? "", /compare reports/);
    assert.match(runLocalCommand("list sources") ?? "", /owner/);
    assert.match(runLocalCommand("list attempts research") ?? "", /read the brief/);
    recordInformation({ action: "access", recordId: "note", actor: "adrian", at: 1, detail: "sk-secretkey opened" });
    runLocalCommand("blueprint status");
    reloadLocalCapabilities();
    const events = inspectInformation();
    assert.equal(events.at(-1)?.recordId, "note");
    assert.match(events.at(-1)?.detail ?? "", /redacted/);
    assert.doesNotMatch(events.at(-1)?.detail ?? "", /sk-secretkey/);
  });
});
