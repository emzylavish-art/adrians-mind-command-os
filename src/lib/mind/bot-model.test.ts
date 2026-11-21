import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addCustomAgent, editBot, readFleet } from "./fleet.ts";
import { normalizeBotModel, routeForBotChat } from "./bot-model.ts";
import { botKnowledgeLine, normalizeBotKnowledge } from "./bot-model.ts";
import { chatTurnBody } from "./logic-routes.ts";
import { assembleTurn } from "./prompt.ts";
import { emptyWorkspace, normalizeWorkspace, openBotChat } from "./workspace.ts";

describe("bot model", () => {
  it("drops an unknown provider or tier instead of inventing one", () => {
    assert.deepEqual(normalizeBotModel({ chatProvider: "secret", chatTier: "Huge" }), { chatProvider: null, chatTier: null });
    assert.deepEqual(normalizeBotModel(null), { chatProvider: null, chatTier: null });
  });

  it("keeps a known choice on a saved bot and only applies it to a new chat", () => {
    const made = addCustomAgent(emptyWorkspace(), {
      name: "Pier notes",
      instructions: "Read notes only.",
      tools: ["list_projects"],
      chatProvider: "openai",
      chatTier: "Expert",
    }, "2026-11-20T00:00:00.000Z");
    assert.equal(made.ok, true);
    if (!made.ok) return;
    const saved = normalizeWorkspace(made.ws);
    assert.equal(saved.agents[0]?.chatProvider, "openai");
    assert.equal(saved.agents[0]?.chatTier, "Expert");
    const opened = openBotChat(saved, made.agent.id);
    assert.equal(opened?.chat.botProvider, "openai");
    assert.equal(opened?.chat.botTier, "Expert");
    const again = openBotChat(opened!.ws, made.agent.id);
    assert.equal(again?.chat.id, opened?.chat.id);
    const route = routeForBotChat(opened?.chat, { provider: "grok", modelTier: "Auto" });
    assert.deepEqual(route, { provider: "openai", modelTier: "Expert", fromBot: true });
    assert.deepEqual(routeForBotChat({ botProvider: "nope" }, { provider: "grok", modelTier: "Fast" }), {
      provider: "grok",
      modelTier: "Fast",
      fromBot: false,
    });
  });

  it("edits the bot model without dropping the old id", () => {
    const made = addCustomAgent(emptyWorkspace(), { name: "Pier", instructions: "Read.", tools: ["list_projects"] }, "2026-11-20T00:00:00.000Z");
    assert.equal(made.ok, true);
    if (!made.ok) return;
    const edited = editBot(made.ws, made.agent.id, {
      name: "Pier",
      instructions: "Read.",
      tools: ["list_projects"],
      chatProvider: "grok",
      chatTier: "Fast",
    });
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    assert.equal(edited.agent.id, made.agent.id);
    assert.equal(edited.agent.chatProvider, "grok");
    assert.equal(edited.agent.chatTier, "Fast");
    const loaded = readFleet({ agents: [{ id: "bot-old", name: "Old", chatProvider: "sk-secret", chatTier: "Auto" }] });
    assert.equal(loaded.agents[0]?.chatProvider, null);
    assert.equal(loaded.agents[0]?.chatTier, "Auto");
  });

  it("rejects a key-shaped note and copies a normal note only onto a new chat", () => {
    assert.equal(normalizeBotKnowledge("sk-live-secret").rejected, "That note looks like a key. It was not saved.");
    const made = addCustomAgent(emptyWorkspace(), {
      name: "Notes",
      instructions: "Read.",
      tools: ["list_projects"],
      knowledge: "Pier gate code is written on the board.",
    }, "2026-11-20T00:00:00.000Z");
    assert.equal(made.ok, true);
    if (!made.ok) return;
    const opened = openBotChat(made.ws, made.agent.id);
    assert.equal(opened?.chat.botKnowledge, "Pier gate code is written on the board.");
    const kept = openBotChat(opened!.ws, made.agent.id);
    assert.equal(kept?.chat.botKnowledge, "Pier gate code is written on the board.");
    const rejected = addCustomAgent(emptyWorkspace(), {
      name: "Bad",
      instructions: "Read.",
      tools: ["list_projects"],
      knowledge: "sk-live-secret",
    }, "2026-11-20T00:00:00.000Z");
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.equal(rejected.error, "That note looks like a key. It was not saved.");
    const edited = editBot(opened.ws, made.agent.id, {
      name: "Notes",
      instructions: "Read.",
      tools: ["list_projects"],
      knowledge: "A later note.",
    });
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    const keptAfterEdit = openBotChat(edited.ws, made.agent.id);
    assert.equal(keptAfterEdit?.chat.id, opened?.chat.id);
    assert.equal(keptAfterEdit?.chat.botKnowledge, "Pier gate code is written on the board.");
    const fresh = openBotChat(edited.ws, made.agent.id, true);
    assert.equal(fresh?.chat.botKnowledge, "A later note.");
    const loaded = readFleet({ agents: [{ id: "bot-note", name: "Note", knowledge: "sk-live-secret" }] });
    assert.equal(loaded.agents[0]?.knowledge, "");
    const body = chatTurnBody({
      text: "hi",
      memory: "off",
      halted: false,
      history: [],
      memoryContext: [],
      provider: "openai",
      modelTier: "Expert",
      logicRoute: null,
      images: [],
      botKnowledge: "Pier gate code is written on the board.",
    });
    assert.equal(body.botKnowledge, "Pier gate code is written on the board.");
    const stripped = chatTurnBody({
      text: "hi",
      memory: "off",
      halted: false,
      history: [],
      memoryContext: [],
      provider: "openai",
      modelTier: "Expert",
      logicRoute: null,
      images: [],
      botKnowledge: "sk-live-secret",
    });
    assert.equal("botKnowledge" in stripped, false);
    const sent = assembleTurn({ memory: "off", history: [], text: "Hello", memoryContext: [], botKnowledge: body.botKnowledge });
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    assert.equal(sent.usedIds.length, 0);
    assert.match(sent.messages[0].content as string, /Pier gate code is written on the board/);
    assert.match(sent.messages[0].content as string, /Memory is OFF/);
    assert.equal(botKnowledgeLine("sk-live-secret"), "");
  });
});
