import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
const sharedHeaders = config.headers.find((entry) => entry.source === "/(.*)")?.headers ?? [];
const values = new Map(sharedHeaders.map(({ key, value }) => [key.toLowerCase(), value]));

test("Vercel applies the baseline defensive headers to all routes", () => {
  assert.equal(values.get("x-content-type-options"), "nosniff");
  assert.equal(values.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(values.get("strict-transport-security") ?? "", /max-age=31536000/);
  assert.equal(values.get("x-permitted-cross-domain-policies"), "none");
  assert.match(values.get("permissions-policy") ?? "", /geolocation=\(\)/);
});
