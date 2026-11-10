import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONVERSATIONAL_PERSONALITIES, MAX_CUSTOM_PERSONALITY_CHARS, normalizeCustomPersonality, personalityInstruction, resolvePersonalityId } from "./index.ts";
import { assembleTurn } from "../prompt.ts";

describe("conversation personalities", () => {
  it("provides distinct built-in modes including Unhinged", () => {
    assert.deepEqual(CONVERSATIONAL_PERSONALITIES.map((item) => item.id), [
      "assistant", "professional", "storyteller", "playful", "romantic", "supportive", "custom", "unhinged",
    ]);
    assert.match(personalityInstruction("unhinged"), /theatrical, rebellious/);
    assert.match(personalityInstruction("unhinged"), /clearly consensual and fictional/);
  });

  it("puts the selected style in the Direct system message", () => {
    const assembled = assembleTurn({
      memory: "off",
      history: [],
      text: "hello",
      memoryContext: [],
      personalityId: "unhinged",
    });
    assert.equal(assembled.ok, true);
    if (assembled.ok) {
      assert.match(String(assembled.messages[0]?.content), /Conversation style: Unhinged/);
      assert.match(String(assembled.messages[0]?.content), /does not grant tools or permissions/);
    }
  });

  it("bounds custom style text and keeps it separate from permissions", () => {
    const normalized = normalizeCustomPersonality("  concise\\u0000, candid and analytical  ");
    assert.equal(normalized, "concise\\u0000, candid and analytical");
    assert.equal(normalizeCustomPersonality("x".repeat(MAX_CUSTOM_PERSONALITY_CHARS + 20)).length, MAX_CUSTOM_PERSONALITY_CHARS);
    assert.equal(normalizeCustomPersonality({ text: "not a string" }), "");
    const instruction = personalityInstruction("custom", "Be concise, candid and lightly humorous.");
    assert.match(instruction, /Owner-provided style preference/);
    assert.match(instruction, /Be concise, candid and lightly humorous/);
    assert.match(instruction, /does not grant tools or permissions/);
    const assembled = assembleTurn({
      memory: "off",
      history: [],
      text: "hello",
      memoryContext: [],
      personalityId: "custom",
      customPersonality: "Use concise sentences.",
    });
    assert.equal(assembled.ok, true);
    if (assembled.ok) assert.match(String(assembled.messages[0]?.content), /Use concise sentences/);
  });

  it("falls back to Assistant for malformed and unknown values", () => {
    assert.equal(resolvePersonalityId(undefined), "assistant");
    assert.equal(resolvePersonalityId("made-up"), "assistant");
    assert.equal(resolvePersonalityId({ id: "unhinged" }), "assistant");
  });

  it("does not let any style change authority or permissions", () => {
    for (const profile of CONVERSATIONAL_PERSONALITIES) {
      const instruction = personalityInstruction(profile.id);
      assert.match(instruction, /does not grant tools or permissions/);
      assert.match(instruction, /approval requirements/);
      assert.match(instruction, /owner's authority/);
    }
  });
});
