import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHARACTER_CAPACITY,
  MIND_CHARACTERS,
  characterVoiceId,
  readStoredCharacterId,
  resolveCharacterId,
  rosterAvailability,
  writeStoredCharacterId,
} from "./index.ts";

describe("character roster", () => {
  it("fills five adult female operators and leaves the rest of the roster empty", () => {
    assert.equal(MIND_CHARACTERS.length, 5);
    assert.ok(MIND_CHARACTERS.every((item) => item.sex === "female"));
    const availability = rosterAvailability();
    assert.equal(availability.femaleFilled, 5);
    assert.equal(availability.femaleOpen, CHARACTER_CAPACITY.female - 5);
    assert.equal(availability.maleFilled, 0);
    assert.equal(availability.maleOpen, CHARACTER_CAPACITY.male);
    assert.equal(availability.grantsPermissions, false);
    assert.equal(availability.sharedBrain, "Adrian Core");
  });

  it("fails closed to EVE and persists only known ids", () => {
    assert.equal(resolveCharacterId("nope"), "eve");
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    assert.equal(writeStoredCharacterId("luna", storage).voiceId, "luna");
    assert.equal(readStoredCharacterId(storage), "luna");
    assert.equal(writeStoredCharacterId("male-slot", storage).id, "eve");
    assert.equal(characterVoiceId("iris"), "iris");
  });
});
