const { readFileSync } = require("node:fs");
function readNetworkPolicy(file) {
  try { return JSON.parse(readFileSync(file, "utf8")).networkPolicy === "connected-services" ? "connected-services" : "local-only"; }
  catch { return "local-only"; }
}
function nativeDestinationAllowed(value, policy) {
  if (policy === "connected-services") return true;
  try {
    const url = new URL(typeof value === "string" ? value : value instanceof URL ? value.href : value.url);
    return ["http:", "https:", "ws:", "wss:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase());
  } catch { return false; }
}
function installNativeFetchPolicy(target, readPolicy) {
  const original = target.fetch;
  target.fetch = function (input, init) {
    const policy = readPolicy();
    if (!nativeDestinationAllowed(input, policy)) return Promise.reject(Object.assign(new Error("Local-only mode prohibits this external request. No external service was called."), { code: "ADRIAN_LOCAL_ONLY", outcome: "not_sent" }));
    // In local-only mode, a local service must not redirect the app to a cloud provider.
    return original.call(target, input, policy === "local-only" ? { ...init, redirect: "error" } : init);
  };
  return () => { target.fetch = original; };
}
if (process.env.ADRIAN_PC === "1" && process.env.ADRIAN_NATIVE_PREFERENCES && !process.env.VERCEL) installNativeFetchPolicy(globalThis, () => readNetworkPolicy(process.env.ADRIAN_NATIVE_PREFERENCES));
module.exports = { nativeDestinationAllowed, readNetworkPolicy, installNativeFetchPolicy };
