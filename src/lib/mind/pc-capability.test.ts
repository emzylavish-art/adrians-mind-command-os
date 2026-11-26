import assert from "node:assert/strict";
import test from "node:test";
import { missingPcCapabilities, PC_CAPABILITIES } from "./pc-capability.ts";
test("implemented adapters and required capabilities are separate from live-device proof", () => {
  for (const id of ["screen-capture", "visual-understanding", "accessibility-tree", "window-management"]) assert.equal(PC_CAPABILITIES.find(item => item.id === id)?.state, "coded");
  for (const id of ["browser-automation", "background-worker", "cross-device", "robotics"]) assert.equal(missingPcCapabilities().includes(id), true);
  assert.equal(PC_CAPABILITIES.every(item => item.verification === "unverified"), true);
  assert.equal(PC_CAPABILITIES.find(item => item.id === "offline-text")?.offline, "requires-local-engine");
});
