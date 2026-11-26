import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { pinnedHttpFetch } from "./http-dns-pin.ts";
import { consumeProviderStream } from "../ai-provider-stream.ts";

test("opt-in pinned transport emits a provider delta before the fixture finishes", { timeout: 3000 }, async t => {
  let finish: (() => void) | undefined;
  let ended = false;
  const server = createServer((request, response) => {
    assert.equal(request.headers.host, "provider.fixture");
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"model":"fixture","choices":[{"delta":{"content":"first"}}]}\n\n');
    finish = () => { ended = true; response.end('data: {"choices":[{"delta":{"content":" second"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); };
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = new URL(`http://provider.fixture:${(server.address() as AddressInfo).port}/stream`);
  const response = await pinnedHttpFetch(url, "127.0.0.1", "provider.fixture", { streamResponse: true });
  assert.ok(response.body);
  const chunks: string[] = [];
  const result = await consumeProviderStream("openai", response.body, text => { chunks.push(text); if (text === "first") { assert.equal(ended, false); finish!(); } });
  assert.equal(result.ok, true); assert.deepEqual(chunks, ["first", " second"]);
});
