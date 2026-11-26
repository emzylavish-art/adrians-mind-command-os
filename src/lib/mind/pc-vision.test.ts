import test from "node:test";
import assert from "node:assert/strict";
import { analyzePcScreenshot, type VisionPolicy } from "./pc-vision.ts";
const policy: VisionPolicy = { model: "selected-model", allowExternalImage: true, allowFallback: false, captureScope: "primary-screen", timeoutMs: 100 };
const image = Buffer.alloc(64);
test("vision selected model is exact, receipt attributed, and no implicit fallback is paid", async () => {
  const models: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => { const body = JSON.parse(String(init?.body)); models.push(body.model); return Response.json({ error: "unsupported image" }, { status: 400 }); };
  const result = await analyzePcScreenshot(image, "synthetic", policy, { fetch: fetcher });
  assert.deepEqual(models, ["selected-model"]); assert.equal(result.state, "failed"); assert.equal(result.attempts, 1);
});
test("only an explicitly allowed compatible fallback is attempted", async () => {
  const models: string[] = [];
  const result = await analyzePcScreenshot(image, "synthetic", { ...policy, allowFallback: true, fallbackModel: "approved-fallback" }, { fetch: async (_url, init) => { const body = JSON.parse(String(init?.body)); models.push(body.model); return models.length === 1 ? Response.json({ error: "unsupported vision" }, { status: 422 }) : Response.json({ model: body.model, output: [{ content: [{ text: "fixture image" }] }] }); } });
  assert.deepEqual(models, ["selected-model", "approved-fallback"]); assert.equal(result.actualModel, "approved-fallback"); assert.equal(result.state, "completed");
});
test("missing/mismatched model receipt cannot claim selected provider success", async () => {
  for (const model of [undefined, "wrong-model"]) {
    const result = await analyzePcScreenshot(image, "synthetic", policy, { fetch: async () => Response.json({ model, output: [{ content: [{ text: "fixture" }] }] }) });
    assert.equal(result.state, "unconfirmed"); assert.equal(result.actualModel, model || null);
  }
});
test("image authorization loss blocks first or second model with zero extra dispatch", async () => {
  let calls = 0;
  const none = await analyzePcScreenshot(image, "synthetic", policy, { authorize: () => false, fetch: async () => { calls++; return Response.json({}); } });
  assert.equal(none.attempted, false); assert.equal(calls, 0);
  const changed = await analyzePcScreenshot(image, "synthetic", { ...policy, allowFallback: true, fallbackModel: "second" }, { authorize: model => model === "selected-model", fetch: async () => { calls++; return Response.json({ error: "unsupported vision" }, { status: 400 }); } });
  assert.equal(changed.attempts, 1); assert.equal(calls, 1); assert.equal(changed.state, "blocked");
});
test("provider and body timeouts are bounded even when callbacks ignore AbortSignal", async () => {
  for (const fetcher of [() => new Promise<Response>(() => {}), async () => ({ ok: true, text: () => new Promise<string>(() => {}) }) as unknown as Response]) {
    const result = await analyzePcScreenshot(image, "synthetic", { ...policy, timeoutMs: 8 }, { fetch: fetcher as typeof fetch });
    assert.equal(result.state, "unconfirmed"); assert.equal(result.attempts, 1);
  }
});
test("a pre-canceled request captures no external processing", async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const result = await analyzePcScreenshot(image, "synthetic", policy, { signal: controller.signal, fetch: async () => { calls++; return Response.json({}); } });
  assert.equal(result.state, "canceled"); assert.equal(calls, 0);
});
test("truthy strings and invalid model types cannot authorize image processing", async () => {
  let calls = 0;
  for (const invalid of [{ ...policy, allowExternalImage: "yes" }, { ...policy, model: 42 }]) {
    const result = await analyzePcScreenshot(image, "synthetic", invalid as unknown as VisionPolicy, { fetch: async () => { calls++; return Response.json({}); } });
    assert.equal(result.state, "blocked");
  }
  assert.equal(calls, 0);
});
