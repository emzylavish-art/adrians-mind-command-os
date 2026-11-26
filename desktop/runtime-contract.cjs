const { createHmac, timingSafeEqual, randomBytes } = require("node:crypto");
function runtimePayload(value, challenge) {
  return JSON.stringify([challenge, value.product, value.build, value.version, value.revision, value.deviceId, value.artifactId, value.dirty, value.storage, value.essentialRoutes]);
}
function readinessReceipt(identity, challenge, secret, storage) {
  const receipt = { product: "adrians-mind", build: identity.build, version: identity.version, revision: identity.revision || null, deviceId: identity.deviceId, artifactId: identity.artifactId, dirty: identity.dirty, storage: storage ? "ready" : "unavailable", essentialRoutes: storage ? "ready" : "unavailable" };
  return { ...receipt, proof: createHmac("sha256", secret).update(runtimePayload(receipt, challenge)).digest("hex") };
}
function validateReadiness(value, expected, challenge, secret) {
  if (!value || value.product !== "adrians-mind" || value.build !== expected.build || value.version !== expected.version || (value.revision || null) !== (expected.revision || null) || value.deviceId !== expected.deviceId || value.artifactId !== expected.artifactId || value.dirty !== expected.dirty || value.storage !== "ready" || value.essentialRoutes !== "ready" || typeof value.proof !== "string" || !/^[a-f0-9]{64}$/.test(value.proof)) return false;
  const proof = createHmac("sha256", secret).update(runtimePayload(value, challenge)).digest();
  return timingSafeEqual(proof, Buffer.from(value.proof, "hex"));
}
async function waitForRuntime(url, child, expected, secret, options = {}) {
  const now = options.now || Date.now;
  const deadline = now() + (options.timeoutMs ?? 45000);
  const pause = options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const read = options.fetch || fetch;
  while (now() < deadline) {
    if (child.exitCode !== null || child.killed || child.spawnFailed) throw new Error("local_runtime_stopped");
    const challenge = randomBytes(24).toString("hex");
    const controller = new AbortController();
    let timer;
    const expiry = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("local_readiness_timeout")); }, Math.min(1500, Math.max(1, deadline - now()))); });
    try {
      const response = await Promise.race([read(url, { redirect: "error", headers: { "x-adrian-runtime-challenge": challenge }, signal: controller.signal }), expiry]);
      if (response.status === 200 && (response.headers.get("content-type") || "").includes("application/json")) {
        const body = await Promise.race([response.json(), expiry]);
        if (validateReadiness(body, expected, challenge, secret)) return body;
      }
    } catch { /* Retry the read-only local health probe until its single deadline. */ }
    finally { clearTimeout(timer); controller.abort(); }
    await pause(Math.min(400, Math.max(0, deadline - now())));
  }
  throw new Error("local_runtime_unverified");
}
function createRestartBudget({ limit = 3, windowMs = 300000, now = Date.now } = {}) {
  let attempts = [];
  return { take() { attempts = attempts.filter(at => now() - at < windowMs); if (attempts.length >= limit) return false; attempts.push(now()); return true; }, remaining() { return Math.max(0, limit - attempts.filter(at => now() - at < windowMs).length); } };
}
function redactDiagnostics(value) {
  return String(value).replace(/(?:Bearer\s+|(?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, "[redacted]").replace(/[A-Z]:\\Users\\[^\\\r\n]+/gi, "%USERPROFILE%").replace(/\/home\/[^/\s]+/g, "~").slice(-8000);
}
module.exports = { readinessReceipt, validateReadiness, waitForRuntime, createRestartBudget, redactDiagnostics };
