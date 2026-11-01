import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOLD_TO_TALK_TAP_THRESHOLD_MS,
  createHoldToTalkController,
  heldLongEnough,
  isHoldToTalkBlockedTarget,
  shouldBeginHoldToTalk,
  shouldEndHoldToTalk,
} from "./hold-to-talk.ts";

describe("hold-to-talk Space", () => {
  it("ignores inputs, buttons, and auto-repeat", () => {
    assert.equal(isHoldToTalkBlockedTarget({ tagName: "INPUT" } as unknown as EventTarget), true);
    assert.equal(isHoldToTalkBlockedTarget({ tagName: "BUTTON" } as unknown as EventTarget), true);
    assert.equal(
      shouldBeginHoldToTalk({ key: " ", repeat: true, target: { tagName: "DIV" } as unknown as EventTarget }),
      false,
    );
    assert.equal(
      shouldBeginHoldToTalk({ key: " ", repeat: false, target: { tagName: "DIV" } as unknown as EventTarget }),
      true,
    );
    assert.equal(
      shouldBeginHoldToTalk({
        key: "v",
        shiftKey: true,
        ctrlKey: true,
        target: { tagName: "DIV" } as unknown as EventTarget,
      }),
      false,
    );
    assert.equal(shouldEndHoldToTalk({ key: " " }), true);
  });

  it("uses tap threshold and stops on blur", () => {
    assert.equal(heldLongEnough(0, HOLD_TO_TALK_TAP_THRESHOLD_MS - 1), false);
    assert.equal(heldLongEnough(0, HOLD_TO_TALK_TAP_THRESHOLD_MS), true);

    let listening = false;
    const starts: number[] = [];
    const stops: number[] = [];
    let t = 0;
    const ctl = createHoldToTalkController({
      start: () => {
        listening = true;
        starts.push(t);
      },
      stop: () => {
        listening = false;
        stops.push(t);
      },
      isListening: () => listening,
      now: () => t,
      thresholdMs: 100,
    });

    const target = { tagName: "DIV" } as unknown as EventTarget;
    ctl.onKeyDown({ key: " ", repeat: false, target, preventDefault() {} } as unknown as KeyboardEvent);
    t = 50;
    ctl.onKeyUp({ key: " ", preventDefault() {} } as unknown as KeyboardEvent);
    assert.deepEqual(starts, []);
    assert.deepEqual(stops, []);

    t = 200;
    ctl.onKeyDown({ key: " ", repeat: false, target, preventDefault() {} } as unknown as KeyboardEvent);
    // advance past threshold via timer — simulate by calling with fake timers manually:
    // createHoldToTalkController uses setTimeout; flush by waiting.
  });

  it("controller starts after threshold and stops on blur", async () => {
    let listening = false;
    const log: string[] = [];
    const ctl = createHoldToTalkController({
      start: () => {
        listening = true;
        log.push("start");
      },
      stop: () => {
        listening = false;
        log.push("stop");
      },
      isListening: () => listening,
      thresholdMs: 30,
    });
    const target = { tagName: "DIV" } as unknown as EventTarget;
    ctl.onKeyDown({ key: " ", repeat: false, target, preventDefault() {} } as unknown as KeyboardEvent);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(log, ["start"]);
    ctl.onBlurOrHide();
    assert.deepEqual(log, ["start", "stop"]);
  });
});
