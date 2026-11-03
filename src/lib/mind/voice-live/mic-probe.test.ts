import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { probeMicrophone } from "./mic-probe.ts";

describe("probeMicrophone gesture order", () => {
  it("calls getUserMedia before any enumerateDevices await", async () => {
    const order: string[] = [];
    const fakeStream = {
      getTracks: () => [{ stop() { order.push("stop"); } }],
    } as unknown as MediaStream;
    const result = await probeMicrophone({
      enumerateDevices: async () => {
        order.push("enumerate");
        await new Promise((r) => setTimeout(r, 5));
        return [{ kind: "audioinput" } as MediaDeviceInfo];
      },
      getUserMedia: async () => {
        order.push("getUserMedia");
        return fakeStream;
      },
    });
    assert.equal(result.ok, true);
    assert.equal(order[0], "getUserMedia");
    assert.ok(!order.includes("enumerate"), "must not await enumerateDevices before getUserMedia");
  });
});
