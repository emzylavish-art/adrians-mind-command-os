import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveFocusBotRequest,
  takePendingFocus,
  writePendingFocus,
} from "./focus-request.ts";

const bots = [
  { id: "logic" },
  { id: "conductor" },
  { id: "cosmos-motion" },
  { id: "dashboard" },
  { id: "voice-wiring" },
];

describe("Gap#10 focus-request — latest wins + unknown clears", () => {
  it("unknown / empty id clears selection and pending", () => {
    assert.deepEqual(resolveFocusBotRequest("does-not-exist", bots, { gliding: true }), {
      kind: "clear",
      pendingId: null,
      startCamera: false,
    });
    assert.equal(resolveFocusBotRequest("", bots, { gliding: false }).kind, "clear");
    assert.equal(resolveFocusBotRequest(null, bots, { gliding: false }).kind, "clear");
  });

  it("rapid sequence with preferRetarget always starts camera on latest id", () => {
    let pending: string | null = null;
    let selected: string | null = null;
    let cameraSubject: string | null = null;
    for (const id of ["logic", "dashboard", "voice-wiring", "conductor", "cosmos-motion"]) {
      const r = resolveFocusBotRequest(id, bots, { gliding: cameraSubject != null, preferRetarget: true });
      if (r.kind === "clear") {
        selected = null;
        pending = null;
        continue;
      }
      selected = r.botId;
      pending = writePendingFocus(pending, r.pendingId);
      if (r.startCamera) {
        cameraSubject = r.botId;
        pending = null;
      }
    }
    assert.equal(selected, "cosmos-motion");
    assert.equal(cameraSubject, "cosmos-motion");
    assert.equal(pending, null);
  });

  it("without retarget, pending keeps latest until glide ends", () => {
    let pending: string | null = null;
    let selected: string | null = null;
    for (const id of ["logic", "conductor", "cosmos-motion"]) {
      const r = resolveFocusBotRequest(id, bots, { gliding: true, preferRetarget: false });
      assert.equal(r.kind, "select");
      if (r.kind !== "select") continue;
      selected = r.botId;
      pending = writePendingFocus(pending, r.pendingId);
      assert.equal(r.startCamera, false);
    }
    assert.equal(selected, "cosmos-motion");
    assert.equal(pending, "cosmos-motion");
    const taken = takePendingFocus(pending);
    assert.equal(taken.id, "cosmos-motion");
    assert.equal(taken.pendingId, null);
  });
});
