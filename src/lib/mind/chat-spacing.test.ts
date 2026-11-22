import assert from "node:assert/strict";
import test from "node:test";
import { allowedLeftEdges, spacingTokens, usesSpacingToken } from "./chat-spacing.ts";

test("chat left edges are the gutter or the defined assistant indent", () => {
  assert.deepEqual(allowedLeftEdges(), [16, 28]);
});

test("spacing tokens are on a 4px base", () => {
  assert.deepEqual(spacingTokens, [4, 8, 12, 16, 24]);
  assert.equal(spacingTokens.every(usesSpacingToken), true);
  assert.equal(usesSpacingToken(7), false);
  assert.equal(usesSpacingToken(10), false);
});
