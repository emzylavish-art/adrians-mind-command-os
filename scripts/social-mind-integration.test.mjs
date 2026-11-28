import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../src/routes/social.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../public/apps/social/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/apps/social/app.js", import.meta.url), "utf8");

test("Mind Social embeds the verified workspace and does not invent a phone-to-PC host", () => {
  assert.match(page, /Social workspace/);
  assert.match(page, /Your Social connections/);
  assert.match(page, /id="api-base"/);
  assert.match(route, /src="\/apps\/social\/index\.html"/);
  assert.match(route, /A phone cannot reach 127\.0\.0\.1:8765/);
  assert.match(route, /Live platform connections are unverified/);
  assert.doesNotMatch(route, /src="http:\/\/127\.0\.0\.1:8765/);
  assert.doesNotMatch(route, /X-Adrian-Secret/);
  assert.doesNotMatch(app, /127\.0\.0\.1:8765/);
  assert.match(app, /\["localhost","127\.0\.0\.1"\]\.includes\(location\.hostname\)/);
});
