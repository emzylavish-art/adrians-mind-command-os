import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasAudioInputDevice, mapGetUserMediaError, probeMicrophone } from "./mic-probe.ts";

describe("mic probe", () => {
  it("reports no device when enumerateDevices has no audioinput", async () => {
    const has = await hasAudioInputDevice(async () => [{ kind: "videoinput" } as MediaDeviceInfo]);
    assert.equal(has, false);
    const probe = await probeMicrophone({
      enumerateDevices: async () => [],
      getUserMedia: async () => {
        throw new Error("should not call getUserMedia");
      },
    });
    assert.equal(probe.ok, false);
    if (!probe.ok) {
      assert.equal(probe.code, "no_device");
      assert.match(probe.error, /No microphone found/);
    }
  });

  it("maps NotAllowedError / NotFoundError / NotReadableError", () => {
    assert.match(mapGetUserMediaError({ name: "NotAllowedError", message: "denied" }).error, /permission was denied/i);
    assert.match(mapGetUserMediaError({ name: "NotFoundError", message: "x" }).error, /No microphone found/i);
    assert.match(mapGetUserMediaError({ name: "NotReadableError", message: "busy" }).error, /busy or unreadable/i);
  });

  it("returns ok when a device exists and getUserMedia resolves", async () => {
    const probe = await probeMicrophone({
      enumerateDevices: async () => [{ kind: "audioinput", deviceId: "1", label: "mic", groupId: "", toJSON() { return {}; } } as MediaDeviceInfo],
      getUserMedia: async () =>
        ({
          getTracks: () => [{ stop() {} }],
        }) as unknown as MediaStream,
    });
    assert.equal(probe.ok, true);
  });
});
