import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [login, root, vercelText] = await Promise.all([
  readFile("src/routes/login.tsx", "utf8"),
  readFile("src/routes/__root.tsx", "utf8"),
  readFile("vercel.json", "utf8"),
]);
const vercel = JSON.parse(vercelText);

test("/signup redirects to the existing sign-up mode without weakening redirect validation", () => {
  assert.ok(vercel.redirects?.some((rule) => rule.source === "/signup" && rule.destination === "/login?mode=sign-up" && rule.permanent === false));
  assert.match(login, /mode:\s*search\.mode === "sign-up" \? "sign-up" : undefined/);
  assert.match(login, /useState<Mode>\(search\.mode \?\? "sign-in"\)/);
  assert.match(login, /const next = safeRedirectPath\(search\.next\)/);
});

test("deployment config applies baseline security headers without a breaking CSP", () => {
  const all = vercel.headers?.find((rule) => rule.source === "/(.*)")?.headers ?? [];
  const header = (key) => all.find((entry) => entry.key.toLowerCase() === key.toLowerCase())?.value;
  assert.equal(header("X-Content-Type-Options"), "nosniff");
  assert.equal(header("X-Frame-Options"), "DENY");
  assert.equal(header("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(header("Content-Security-Policy"), undefined);
});

test("unknown routes offer a real home return link", () => {
  assert.match(root, /notFoundComponent:\s*\(\) =>/);
  assert.match(root, /Page not found/);
  assert.match(root, /<Link to="\/"[\s\S]*>Return to Adrian&apos;s Mind<\/Link>/);
});
