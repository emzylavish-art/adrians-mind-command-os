import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { createBrowserRuntime } from "./runtime.mjs";
import { createBrowserWorker } from "./server.mjs";
import { resolveBrowserPin } from "./network.mjs";

test("managed browser pins public DNS and rejects mixed, reserved and IPv6-only answers", async () => {
  const resolve = addresses => resolveBrowserPin("fixture.example", async () => addresses);
  assert.equal(await resolve(["93.184.216.34", "2606:4700::1111"]), "93.184.216.34");
  for (const addresses of [[], ["93.184.216.34", "127.0.0.1"], ["192.0.2.1"], ["198.18.0.1"], ["2606:4700::1111"]]) {
    await assert.rejects(resolve(addresses));
  }
});

test("worker requires its own bearer and validates commands", async t => {
  const calls = [];
  const token = "local-fixture-token-for-browser-worker-only";
  const server = createBrowserWorker({ token, runtime: { run: async input => {
    calls.push(input);
    return { status: 200, body: { phase: "closed" } };
  } } });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const request = (body, bearer) => fetch("http://127.0.0.1:" + server.address().port + "/session", {
    method: "POST", headers: { authorization: "Bearer " + bearer }, body: JSON.stringify(body),
  });
  const id = randomUUID();
  assert.equal((await request({ id, action: "start" }, "unrelated")).status, 401);
  assert.equal((await request({ id, action: "script" }, token)).status, 400);
  assert.equal((await request({ id, action: "follow", x: 1200, y: 10 }, token)).status, 400);
  assert.equal((await request({ id, action: "recover" }, token)).status, 200);
  assert.deepEqual(calls.map(({ input }) => input), [{ action: "recover" }]);
});

const executablePath = process.env.MIND_BROWSER_FIXTURE_CHROMIUM;
test("isolated Chromium captures frames and hands back owner navigation", { skip: !executablePath }, async t => {
  const loads = [];
  const origin = "https://fixture.example";
  const runtime = createBrowserRuntime({
    origins: new Set([origin]), executablePath,
    chromiumSandbox: process.env.MIND_BROWSER_FIXTURE_NO_SANDBOX !== "1",
    pin: async () => "93.184.216.34",
    load: async url => {
      loads.push(url.href);
      const body = url.pathname === "/" ? `<a style="position:absolute;top:8px;left:8px" href="/next">Next page</a>
        <a style="position:absolute;top:50px;left:8px" href="https://outside.example/">Other site</a>
        <form action="/submit"><input name="secret"><button>Submit</button></form>
        <img src="https://outside.example/pixel"><script src="/run.js"></script><iframe src="/frame"></iframe>
        <div style="height:1800px"></div>` : '<h1>Second page</h1><div style="height:1600px"></div>';
      return { contentType: "text/html", body: Buffer.from(body) };
    },
  });
  t.after(() => runtime.close());
  const id = randomUUID();
  const action = (input, target) => runtime.run({ id, input, target, expires: Date.now() + 15_000 });
  const attempt = await action({ action: "start" }, "https://outside.example");
  assert.equal(attempt.status, 400);
  const opened = await action({ action: "start" }, origin);
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.phase, "managed");
  assert.match(opened.body.frame.image, /^\/9j\//);
  assert.equal((await action({ action: "follow", x: 12, y: 12 })).status, 409);
  const taken = await action({ action: "takeover" });
  assert.equal(taken.body.phase, "manual");
  assert.deepEqual(taken.body.frame.links.map(link => link.label), ["Next page"]);
  const refused = await action({ action: "follow", x: 12, y: 54 });
  assert.equal(refused.body.refusedLink, true);
  assert.equal(refused.body.frame.path, "/");
  const moved = await action({ action: "follow", x: 12, y: 12 });
  assert.equal(moved.body.frame.path, "/next");
  const scrolled = await action({ action: "scroll", delta: 550 });
  assert.notEqual(scrolled.body.frame.image, moved.body.frame.image);
  assert.equal((await action({ action: "handback" })).body.phase, "managed");
  assert.equal((await action({ action: "stop" })).body.phase, "closed");
  assert.equal((await action({ action: "recover" })).body.phase, "closed");
  assert.equal((await action({ action: "start" }, origin)).body.phase, "closed");
  assert.deepEqual(loads, [origin + "/", origin + "/next"]);
});
