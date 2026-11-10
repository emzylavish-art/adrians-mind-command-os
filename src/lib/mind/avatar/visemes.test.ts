import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync } from "node:fs";
import { MIND_CHARACTERS } from "../characters/index.ts";
import { expressionForPresence, plateForExpression } from "./presence.ts";
import { noteSpokenText, readAvatarSession, resetAvatarSession, setAvatarPresence } from "./session.ts";
import { planVisemes, visemeAt, visemeForLetter } from "./visemes.ts";

describe("viseme plan", () => {
  it("maps letters to mouth shapes and returns to rest at the end of the audio", () => {
    assert.equal(visemeForLetter("a"), "aa");
    assert.equal(visemeForLetter("o"), "oo");
    assert.equal(visemeForLetter("e"), "ee");
    assert.equal(visemeForLetter("m"), "mm");
    const cues = planVisemes("hello", 1000);
    assert.equal(cues[0]?.id, "rest");
    assert.equal(cues.at(-1)?.id, "rest");
    assert.equal(visemeAt(cues, 1000), "rest");
    assert.equal(visemeAt(cues, 250), "ee");
  });

  it("does not invent a mouth shape when nothing was spoken", () => {
    assert.deepEqual(planVisemes("   ", 1000), [{ id: "rest", at: 0, until: 1000 }]);
    assert.equal(visemeAt(planVisemes("hello", 0), 0), "rest");
  });
});

describe("avatar presence", () => {
  it("maps operating states onto plates we actually have", () => {
    assert.equal(expressionForPresence("listening"), "listening");
    assert.equal(expressionForPresence("error"), "concerned");
    assert.equal(expressionForPresence("speaking"), "speaking");
    assert.equal(plateForExpression("surprised"), "listening");
    assert.equal(plateForExpression("laughing"), "smiling");
    assert.equal(expressionForPresence("offline"), "serious");
  });

  it("keeps the spoken text only while speaking", () => {
    resetAvatarSession();
    noteSpokenText("Hello from EVE");
    assert.equal(readAvatarSession().presence, "speaking");
    assert.match(readAvatarSession().utterance, /EVE/);
    setAvatarPresence("interrupted");
    assert.equal(readAvatarSession().utterance, "");
    assert.equal(readAvatarSession().presence, "interrupted");
  });
});

describe("character plates", () => {
  it("points every filled character at a real portrait file", () => {
    for (const character of MIND_CHARACTERS) {
      assert.equal(existsSync(`public${character.portrait}`), true, character.id);
      for (const path of Object.values(character.visemes)) {
        assert.equal(existsSync(`public${path}`), true, path);
      }
      if (character.fullBody) assert.equal(existsSync(`public${character.fullBody}`), true);
    }
    assert.equal(existsSync("public/characters/eve/viseme-ee.jpg"), true);
    assert.equal(existsSync("public/characters/eve/full.jpg"), true);
  });
});
