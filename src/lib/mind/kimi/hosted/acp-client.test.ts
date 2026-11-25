import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { closeHostedCodingSession, probeKimiAcp, runCodingTurn } from "./acp-client.ts";

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
