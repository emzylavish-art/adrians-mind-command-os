import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { closeHostedCodingSession, probeKimiAcp, runCodingTurn } from "./acp-client.ts";

describe("hosted Kimi ACP client", () => {
  it("keeps turn receipts separate, preserves long output, and refuses unacknowledged mode changes", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "coding-contract-"));
    const fake = join(dir, "contract.mjs");
    const previous = Object.fromEntries(["KIMI_BIN", "KIMI_CODE_HOME", "ADRIAN_BUILD_WORKSPACE"].map(k => [k, process.env[k]]));
    Object.assign(process.env, { KIMI_BIN: fake, KIMI_CODE_HOME: join(dir, "home"), ADRIAN_BUILD_WORKSPACE: dir });
    t.after(() => {
      closeHostedCodingSession("contract");
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      rmSync(dir, { recursive: true, force: true });
    });
    writeFileSync(fake, `
      import { createInterface } from "node:readline";
      const send = m => console.log(JSON.stringify({ jsonrpc: "2.0", ...m }));
      let turn; let failAfterWrite = false;
      createInterface({ input: process.stdin }).on("line", line => {
        const m = JSON.parse(line);
        if (m.method === "session/set_mode" && m.params.modeId === "plan") send({ id:m.id, error:{message:"fixture rejected mode"} });
        else if (m.method === "session/prompt") {
          turn = m.id;
          const text = m.params.prompt[0].text;
          failAfterWrite = text.endsWith("write-fail");
          if (text.endsWith("write")) send({id:"file",method:"fs/write_text_file",params:{path:"change.txt",content:"verified local change"}});
          else if (failAfterWrite) send({id:"file",method:"fs/write_text_file",params:{path:"partial.txt",content:"partial local change"}});
          else if (text.endsWith("long")) {
            send({method:"session/update",params:{sessionUpdate:"agent_message_chunk",content:{text:"x".repeat(20000)}}});
            send({id:turn,result:{text:"TRAILING TEST FAILED"}});
          } else send({id:turn,result:{}});
        } else if (m.id === "file") send(failAfterWrite ? {id:turn,error:{message:"fixture failed after file operation"}} : {id:turn,result:{}});
        else if (m.method) send({id:m.id,result:m.method === "session/new" ? {sessionId:"contract"} : {}});
      });`);
    const first = await runCodingTurn({ prompt: "write", cwd: dir, mode: "auto", ownerId: "fixture-owner", persistFile: async (owner) => owner === "fixture-owner" });
    assert.equal(first.ok, true);
    assert.equal(first.toolReceipts?.[0].status, "succeeded");
    assert.deepEqual(first.filesChanged, [{ path: "change.txt", before: "", after: "verified local change", beforeExists: false }]);
    assert.match(first.output!, /write was verified/);
    assert.equal(first.verification?.implementation, "unverified");
    const second = await runCodingTurn({ prompt: "quiet", cwd: dir, mode: "auto", resumeSessionId: first.sessionId, ownerId: "fixture-owner" });
    assert.deepEqual(second.clientCalls, []);
    assert.deepEqual(second.toolReceipts, []);
    assert.deepEqual(second.filesChanged, []);
    assert.match(second.output!, /No file write/);
    assert.notEqual(first.operationId, second.operationId);
    const rejected = await runCodingTurn({ prompt: "write", cwd: dir, mode: "plan", resumeSessionId: first.sessionId, ownerId: "fixture-owner" });
    assert.equal(rejected.ok, false); assert.equal(rejected.mode, "auto"); assert.match(rejected.error!, /No task was dispatched/);
    const long = await runCodingTurn({ prompt: "long", cwd: dir, mode: "auto", resumeSessionId: first.sessionId, ownerId: "fixture-owner" });
    assert.equal(long.outputComplete, true); assert.ok(long.output!.length > 20_000); assert.ok(long.output!.endsWith("TRAILING TEST FAILED"));
    const denied = await runCodingTurn({ prompt: "write", cwd: dir, mode: "default", resumeSessionId: first.sessionId, ownerId: "fixture-owner" });
    assert.equal(denied.toolReceipts?.[0].status, "denied"); assert.match(denied.output!, /Nothing was written/); assert.match(denied.output!, /writes require/);
    const partial = await runCodingTurn({ prompt: "write-fail", cwd: dir, mode: "auto", resumeSessionId: first.sessionId, ownerId: "fixture-owner", persistFile: async () => false });
    assert.equal(partial.ok, false); assert.equal(partial.requestDispatched, true);
    assert.match(partial.error!, /failed after file operation/); assert.equal(partial.toolReceipts?.[0].status, "written_locally");
    assert.deepEqual(partial.filesChanged, [{ path: "partial.txt", before: "", after: "partial local change", beforeExists: false }]);
    assert.match(partial.output!, /durable persistence unconfirmed/); assert.equal(partial.verification?.implementation, "unverified");
  });

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
      const send = m => console.log(JSON.stringify({ jsonrpc: "2.0", ...m }));
      let turn;
      createInterface({ input: process.stdin }).on("line", line => {
        const m = JSON.parse(line);
        if (m.method === "session/prompt") {
          turn = m.id;
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
  });
});
