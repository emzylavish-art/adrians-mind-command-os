import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { reloadLocalCapabilities, runLocalCommand, setLocalCapabilityFile } from "./local-capabilities.ts";

describe("local capabilities", () => {
  it("lists an obligation without performing it and ignores ordinary chat", () => {
    setLocalCapabilityFile(path.join(mkdtempSync(path.join(tmpdir(), "adrian-local-")), "state.json"));
    assert.equal(runLocalCommand("What is a file?"), null);
    assert.match(runLocalCommand("add obligation file the form") ?? "", /not filed/);
    assert.match(runLocalCommand("list obligations") ?? "", /file the form/);
  });

  it("packs a task, checks a grant, and dry-runs a rename", () => {
    const packed = runLocalCommand("pack task list files");
    assert.equal(JSON.parse(packed ?? "{}").goal, "list files");
    assert.match(runLocalCommand("check grant") ?? "", /revoked/);
    assert.match(runLocalCommand("dry run rename") ?? "", /Executed: false/);
    assert.match(runLocalCommand("list capabilities") ?? "", /Not verified on the HP EliteBook or iPhone/);
  });

  it("stores a note, refuses release without consent, then releases it", () => {
    setLocalCapabilityFile(path.join(mkdtempSync(path.join(tmpdir(), "adrian-local-")), "state.json"));
    assert.match(runLocalCommand("store note private note") ?? "", /Stored n1/);
    assert.match(runLocalCommand("release note n1 for read") ?? "", /consent/);
    assert.match(runLocalCommand("grant consent read") ?? "", /Consent granted/);
    assert.equal(runLocalCommand("release note n1 for read"), "private note");
    runLocalCommand("add obligation keep this");
    runLocalCommand("check grant");
    reloadLocalCapabilities();
    assert.match(runLocalCommand("list obligations") ?? "", /keep this/);
    assert.match(runLocalCommand("inspect information") ?? "", /n1/);
    assert.match(runLocalCommand("list grants") ?? "", /revoked/);
    assert.match(runLocalCommand("crisis on") ?? "", /No emergency service/);
    assert.match(runLocalCommand("add workflow open the report") ?? "", /not scheduled/);
    assert.match(runLocalCommand("set language Yoruba") ?? "", /No translation/);
    assert.match(runLocalCommand("register adapter spatial unspecified") ?? "", /not called/);
  });
});
