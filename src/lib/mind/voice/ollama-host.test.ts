import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLoopbackHostname, resolveSafeOllamaBase } from "./ollama-host.ts";

describe("ollama host SSRF guard", () => {
  it("accepts loopback defaults and rejects remote hosts by default", () => {
    assert.equal(isLoopbackHostname("127.0.0.1"), true);
    assert.equal(isLoopbackHostname("evil.example"), false);
    const ok = resolveSafeOllamaBase("http://127.0.0.1:11434");
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.base, "http://127.0.0.1:11434");
    const bad = resolveSafeOllamaBase("http://169.254.169.254/");
    assert.equal(bad.ok, false);
    const meta = resolveSafeOllamaBase("https://api.x.ai/v1");
    assert.equal(meta.ok, false);
  });

  it("allows remote only when explicitly opted in", () => {
    const remote = resolveSafeOllamaBase("http://10.0.0.5:11434", { allowRemote: true });
    assert.equal(remote.ok, true);
    if (remote.ok) assert.equal(remote.base, "http://10.0.0.5:11434");
  });
});
