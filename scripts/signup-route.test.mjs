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

test("deployment config only permits the two same-origin workspace frames", () => {
  const headersFor = (path) => Object.fromEntries(vercel.headers
    .filter(({ source }) => new RegExp(`^${source}$`).test(path))
    .flatMap(({ headers }) => headers.map(({ key, value }) => [key, value])));
  for (const path of ["/", "/login", "/apps/social/other.html", "/apps/gpt-wrapper/index.html/other"]) {
    const headers = headersFor(path);
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["X-Frame-Options"], "DENY");
    assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.equal(headers["Content-Security-Policy"], undefined);
  }
  for (const path of ["/apps/social/index.html", "/apps/gpt-wrapper/index.html"]) {
    const policies = vercel.headers
      .filter(({ source }) => new RegExp(`^${source}$`).test(path))
      .flatMap(({ headers }) => headers.filter(({ key }) => key === "X-Frame-Options"));
    assert.deepEqual(policies.map(({ value }) => value), ["SAMEORIGIN"]);
    assert.equal(headersFor(path)["Content-Security-Policy"], "frame-ancestors 'self'");
  }
});

test("unknown routes offer a real home return link", () => {
  assert.match(root, /notFoundComponent:\s*\(\) =>/);
  assert.match(root, /Page not found/);
  assert.match(root, /<Link to="\/"[\s\S]*>Return to Adrian&apos;s Mind<\/Link>/);
});
