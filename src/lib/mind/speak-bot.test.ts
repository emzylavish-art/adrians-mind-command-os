import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyWorkspace } from "./workspace.ts";
import { BOT_STAYS_WHILE_OPEN, createBotFromSpeech, parseCreateBot } from "./speak-bot.ts";

describe("createBotFromSpeech", () => {
  it("creates a local bot from Speak or Intelligence and queues it", () => {
    const made = createBotFromSpeech(emptyWorkspace(), "create a bot named Harbor", "2026-11-21T12:00:00.000Z");
    assert.equal(made.ok, true);
    if (!made.ok) return;
    assert.equal(made.name, "Harbor");
    assert.equal(made.ws.agents[0]?.tools.includes("gmail_send"), false);
    assert.equal(made.ws.agents[0]?.tools.includes("browser"), false);
    assert.equal(made.ws.schedules[0]?.enabled, true);
    assert.equal(made.ws.deployments[0]?.target, "local-worker");
    assert.equal(made.ws.runs[0]?.state, "queued");
    assert.match(made.reply, /connected to Speak and Intelligence/);
    assert.match(made.reply, /does not keep running after the app closes/);
    assert.equal(made.reply.includes(BOT_STAYS_WHILE_OPEN), true);
  });

  it("connects a second ask to the saved bot instead of copying it", () => {
    const first = createBotFromSpeech(emptyWorkspace(), "create a bot named Harbor", "2026-11-21T12:00:00.000Z");
    if (!first.ok) throw new Error(first.error);
    const second = createBotFromSpeech(first.ws, "create a bot named Harbor", "2026-11-21T12:05:00.000Z");
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.ws.agents.filter((agent) => agent.name === "Harbor").length, 1);
    assert.equal(second.ws.runs.length, 2);
    assert.match(second.reply, /already saved and connected/);
  });

  it("does not create a bot while the emergency stop is on", () => {
    const stopped = { ...emptyWorkspace(), halted: true };
    const made = createBotFromSpeech(stopped, "create a bot for me");
    assert.equal(made.ok, false);
    if (made.ok) return;
    assert.match(made.error, /No bot was created/);
    assert.equal(made.ws.agents.length, 0);
  });

  it("does not treat an ask to an existing bot as a new bot", () => {
    assert.equal(parseCreateBot("Ask my Documents bot to read the notes"), null);
    assert.equal(parseCreateBot("create an image of a lake"), null);
  });
});
