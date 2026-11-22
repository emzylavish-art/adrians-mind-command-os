import assert from "node:assert/strict";
import test from "node:test";
import { imageRetryPlan } from "./failure-states.ts";

test("an image failure retries in the same conversation", () => {
  const plan = imageRetryPlan([
    { role: "user", content: "/imagine generate a cup" },
    { role: "assistant", kind: "error", content: "Couldn't create the image." },
  ], "chat-1");
  assert.deepEqual(plan, { chatId: "chat-1", prompt: "generate a cup", newChat: false });
});
