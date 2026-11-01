import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpretCommand } from "./intent.ts";

const agents = [
  { id: "a1", name: "Documents", archived: false },
  { id: "a2", name: "Old", archived: true },
];

describe("command intent", () => {
  it("leaves an ordinary question for the chat model", () => {
    assert.equal(interpretCommand("What is a pier?", agents).kind, "chat");
  });

  it("refuses Gmail, search, media, and a computer without calling them", () => {
    const notion = interpretCommand("Update my Notion page", agents);
    assert.equal(notion.kind, "notion");
    const gmail = interpretCommand("Summarize my emails", agents);
    assert.equal(gmail.kind, "blocked");
    if (gmail.kind === "blocked") assert.match(gmail.reply, /Nothing was read or sent/);
    const web = interpretCommand("search the web for piers", agents);
    assert.equal(web.kind, "web_research");
    if (web.kind === "web_research") assert.match(web.query, /piers/i);
    const media = interpretCommand("generate an image of the lake", agents);
    assert.equal(media.kind, "blocked");
    const device = interpretCommand("git commit the fix on my laptop", agents);
    assert.equal(device.kind, "blocked");
    assert.equal(JSON.stringify([gmail, web, media, device]).includes("https://"), false);
  });

  it("routes Research mode to web_research and still blocks Build without a model", () => {
    const research = interpretCommand("latest pier levels", agents, "research");
    assert.equal(research.kind, "web_research");
    if (research.kind === "web_research") assert.match(research.query, /pier/i);
    const build = interpretCommand("fix the button", agents, "build");
    assert.equal(build.kind, "blocked");
    if (build.kind === "blocked") assert.match(build.reply, /No files were changed/);
  });

  it("queues a named bot and does not invent one", () => {
    const found = interpretCommand("Ask my Documents bot to read the notes", agents);
    assert.equal(found.kind, "bot");
    if (found.kind === "bot") assert.equal(found.agentId, "a1");
    const missing = interpretCommand("Ask my Notion bot to update the page", agents);
    assert.equal(missing.kind, "bot_missing");
    const none = interpretCommand("Ask the Harbor agent to look", agents);
    assert.equal(none.kind, "bot_missing");
  });

  it("reads local projects without a model", () => {
    assert.deepEqual(interpretCommand("show my projects", agents), { kind: "local", tool: "list_projects" });
    assert.deepEqual(interpretCommand("search my notes for dock", agents), { kind: "local", tool: "search_notes" });
  });
});
