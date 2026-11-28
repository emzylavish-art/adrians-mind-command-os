import assert from "node:assert/strict";
import { test } from "node:test";
import { githubAction, runGithubAction } from "./github-turn.ts";

const signal = new AbortController().signal;
const sha = "a".repeat(40);

test("an access question lists repositories without sending conversation history", async () => {
  const action = githubAction("Can you access my GitHub?");
  assert.ok(action);
  const reply = await runGithubAction(action, "fixture-token", signal, async (url, init) => {
    assert.equal(new URL(String(url)).origin, "https://api.github.com");
    assert.equal(init?.method, "GET");
    assert.equal(init?.body, undefined);
    assert.equal(init?.redirect, "error");
    return Response.json([{ full_name: "example/demo" }], { headers: { "x-github-request-id": "fixture" } });
  });
  assert.match(reply.text, /example\/demo/);
  assert.equal(reply.requestId, "fixture");
});

test("updating a file requires the current revision, branch and replacement content", async () => {
  assert.equal(githubAction("/github update owner/repo review README.md"), null);
  assert.equal(githubAction("/github read owner/repo main ../outside"), null);
  const action = githubAction(`/github update owner/repo review README.md ${sha}\nReviewed text\n`);
  assert.ok(action);
  const reply = await runGithubAction(action, "fixture", signal, async (_, init) => {
    assert.equal(init?.method, "PUT");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.branch, "review");
    assert.equal(body.sha, sha);
    assert.equal(Buffer.from(body.content, "base64").toString(), "Reviewed text\n");
    return Response.json({ commit: { sha: "b".repeat(40) } });
  });
  assert.match(reply.text, /Commit b{40}/);
  await assert.rejects(runGithubAction(action, "fixture", signal, async () => new Response(null, { status: 409 })), /409/);
  await assert.rejects(runGithubAction(action, "fixture", signal, async () => Response.json({})), /receipt/);
});
