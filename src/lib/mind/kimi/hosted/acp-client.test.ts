import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ADRIAN_OS_BUILDER_OUTPUT, ADRIAN_OS_BUILDER_VERSION } from "../../adrian-os-skill.ts";
import { describe, it } from "node:test";
import { closeHostedCodingSession, probeKimiAcp, runCodingTurn, runHostedPrompt } from "./acp-client.ts";

describe("hosted Kimi ACP client", () => {
  it("answers each ACP permission request once, regardless of option order", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "kimi-permission-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const fake = join(dir, "fake.mjs");
    const previous = Object.fromEntries(["KIMI_BIN", "KIMI_CODE_HOME", "ADRIAN_BUILD_WORKSPACE"].map(k => [k, process.env[k]]));
    Object.assign(process.env, { KIMI_BIN: fake, KIMI_CODE_HOME: join(dir, "home"), ADRIAN_BUILD_WORKSPACE: dir });
    t.after(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    writeFileSync(fake, `
      import { createInterface } from "node:readline";
      import { writeFileSync } from "node:fs";
      const send = m => console.log(JSON.stringify({ jsonrpc: "2.0", ...m }));
      let turn;
      createInterface({ input: process.stdin }).on("line", line => {
        const m = JSON.parse(line);
        if (m.method === "session/prompt") {
          turn = m.id;
          writeFileSync("captured-prompt.json", JSON.stringify(m.params.prompt));
          const options = ["allow_always","reject_always","reject_once","allow_once"]
            .filter(kind => !JSON.stringify(m.params.prompt).includes("permanent-only") || kind.endsWith("always"))
            .map(kind => ({kind, optionId: kind}));
          send({id: "p", method:"session/request_permission", params:{options}});
        } else if (m.id === "p") {
          const outcome = m.result.outcome;
          send({id:turn,result:{text:outcome.optionId || outcome.outcome}});
        } else if (m.method) {
          send({id:m.id,result:m.method === "session/new" ? {sessionId:"fixture"} : {}});
        }
      });`);
    for (const [mode, prompt, expected] of [
      ["auto", "normal", "allow_once"], ["plan", "normal", "reject_once"], ["auto", "permanent-only", "cancelled"],
    ] as const) {
      try {
        const result = await runCodingTurn({ mode, prompt, cwd: dir });
        assert.equal(result.ok, true);
        assert.equal(result.output, expected);
        const received = JSON.parse(readFileSync(join(dir, "captured-prompt.json"), "utf8"))[0].text as string;
        assert.equal(received, `${ADRIAN_OS_BUILDER_OUTPUT}\n\nCurrent task:\n${prompt}`);
        assert.deepEqual(result.instructionReceipt, { id: "adrian-os-builder", version: ADRIAN_OS_BUILDER_VERSION,
          sha256: createHash("sha256").update(ADRIAN_OS_BUILDER_OUTPUT).digest("hex"),
          characters: ADRIAN_OS_BUILDER_OUTPUT.length, delivery: "attached_to_acp_prompt" });
      } finally {
        closeHostedCodingSession("fixture");
      }
    }
  });

  it("does not turn an authentication error into a created session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kimi-probe-"));
    const script = join(dir, "fake-kimi.mjs");
    const wrapper = join(dir, "kimi");
    writeFileSync(script, `let raw=""; process.stdin.on("data", (chunk) => { raw += chunk; if (raw.includes("initialize") && !raw.includes("session/new")) { process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:1,result:{protocolVersion:1,agentInfo:{name:"Fake",version:"0"},agentCapabilities:{loadSession:false,sessionCapabilities:{}}}})+"\\n"); } if (raw.includes("session/new")) { process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:2,error:{code:-32000,message:"Authentication required"}})+"\\n"); } });\n`);
    writeFileSync(wrapper, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`);
    chmodSync(wrapper, 0o755);
    const probe = await probeKimiAcp(wrapper, dir);
    assert.equal(probe.status, "authentication_required");
    assert.equal(probe.runtimeVerified, false);
    assert.equal(probe.version, "0");
    assert.equal(probe.instructionReceipt, undefined, "a handshake failure never claims instructions were sent");
    rmSync(dir, { recursive: true, force: true });
  });
  it("C1 AA034 attaches the same full skill to the one-shot hosted ACP path", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "c1-acp-skill-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const script = join(dir, "fake.mjs");
    writeFileSync(script, `
      import { createInterface } from "node:readline";
      createInterface({ input: process.stdin }).on("line", line => {
        const m = JSON.parse(line);
        const result = m.method === "session/new" ? { sessionId: "fixture" }
          : m.method === "session/prompt" ? { text: m.params.prompt[0].text }
          : { protocolVersion: 1, agentInfo: { name: "fixture" } };
        console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
      });`);
    const previousHome = process.env.KIMI_CODE_HOME;
    const previousWorkspace = process.env.ADRIAN_BUILD_WORKSPACE;
    process.env.KIMI_CODE_HOME = join(dir, "home");
    process.env.ADRIAN_BUILD_WORKSPACE = dir;
    t.after(() => {
      if (previousHome === undefined) delete process.env.KIMI_CODE_HOME; else process.env.KIMI_CODE_HOME = previousHome;
      if (previousWorkspace === undefined) delete process.env.ADRIAN_BUILD_WORKSPACE; else process.env.ADRIAN_BUILD_WORKSPACE = previousWorkspace;
    });
    const result = await runHostedPrompt("fixture task", script, dir);
    assert.equal(result.status, "session_created");
    assert.equal(result.output, `${ADRIAN_OS_BUILDER_OUTPUT}\n\nCurrent task:\nfixture task`);
    assert.equal(result.instructionReceipt?.sha256, createHash("sha256").update(ADRIAN_OS_BUILDER_OUTPUT).digest("hex"));
  });

});
