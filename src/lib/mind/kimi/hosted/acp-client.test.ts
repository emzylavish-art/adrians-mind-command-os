import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { probeKimiAcp } from "./acp-client.ts";

describe("hosted Kimi ACP client", () => {
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
