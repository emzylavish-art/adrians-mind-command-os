import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOLD_TO_TALK_BLOCKED_ROLES,
  HOLD_TO_TALK_TAP_THRESHOLD_MS,
  createHoldToTalkController,
  heldLongEnough,
  isHoldToTalkBlockedTarget,
  isVoiceModalOpen,
  shouldBeginHoldToTalk,
  shouldEndHoldToTalk,
  shouldToggleVoiceShortcut,
} from "./hold-to-talk.ts";

function el(partial: Record<string, unknown>): EventTarget {
  return partial as unknown as EventTarget;
}

describe("hold-to-talk Space", () => {
  it("ignores inputs, buttons, and auto-repeat", () => {
    assert.equal(isHoldToTalkBlockedTarget(el({ tagName: "INPUT" })), true);
    assert.equal(isHoldToTalkBlockedTarget(el({ tagName: "BUTTON" })), true);
    assert.equal(
      shouldBeginHoldToTalk({ key: " ", repeat: true, target: el({ tagName: "DIV" }) }),
      false,
    );
    assert.equal(
      shouldBeginHoldToTalk({ key: " ", repeat: false, target: el({ tagName: "DIV" }) }),
      true,
    );
    assert.equal(
      shouldBeginHoldToTalk({
        key: "v",
        shiftKey: true,
        ctrlKey: true,
        target: el({ tagName: "DIV" }),
      }),
      false,
    );
    assert.equal(shouldEndHoldToTalk({ key: " " }), true);
  });

  it("H14: blocks each ARIA interactive role that uses Space", () => {
    for (const role of HOLD_TO_TALK_BLOCKED_ROLES) {
      assert.equal(
        isHoldToTalkBlockedTarget(
          el({
            tagName: "DIV",
            getAttribute: (name: string) => (name === "role" ? role : null),
          }),
        ),
        true,
        `role=${role}`,
      );
      assert.equal(
        shouldBeginHoldToTalk({
          key: " ",
          target: el({
            tagName: "DIV",
            getAttribute: (name: string) => (name === "role" ? role : null),
          }),
        }),
        false,
        `begin role=${role}`,
      );
    }
  });

  it("H14: blocks contentEditable and closest() ancestors", () => {
    assert.equal(
      isHoldToTalkBlockedTarget(el({ tagName: "DIV", isContentEditable: true })),
      true,
    );
    assert.equal(
      isHoldToTalkBlockedTarget(
        el({
          tagName: "SPAN",
          closest: (sel: string) => (sel.includes("role='tab'") || sel.includes("[role='tab']") ? {} : null),
        }),
      ),
      true,
    );
    assert.equal(
      isHoldToTalkBlockedTarget(
        el({
          tagName: "SPAN",
          closest: (sel: string) => (sel.includes("aria-modal") ? {} : null),
        }),
      ),
      true,
    );
  });

  it("H14: blocks Space and Ctrl+Shift+V while a modal/dialog is open", () => {
    const openModalDoc = {
      querySelector: (sel: string) => (sel.includes("aria-modal") || sel.includes("dialog") ? {} : null),
    };
    const closedDoc = { querySelector: () => null };
    assert.equal(isVoiceModalOpen(openModalDoc), true);
    assert.equal(isVoiceModalOpen(closedDoc), false);
    assert.equal(
      shouldBeginHoldToTalk({ key: " ", target: el({ tagName: "DIV" }) }, openModalDoc),
      false,
    );
    assert.equal(
      shouldBeginHoldToTalk({ key: " ", target: el({ tagName: "DIV" }) }, closedDoc),
      true,
    );
    assert.equal(
      shouldToggleVoiceShortcut(
        { key: "v", shiftKey: true, ctrlKey: true, metaKey: false, target: el({ tagName: "DIV" }) },
        openModalDoc,
      ),
      false,
    );
    assert.equal(
      shouldToggleVoiceShortcut(
        { key: "v", shiftKey: true, ctrlKey: true, metaKey: false, target: el({ tagName: "DIV" }) },
        closedDoc,
      ),
      true,
    );
  });

  it("uses tap threshold and stops on blur", () => {
    assert.equal(heldLongEnough(0, HOLD_TO_TALK_TAP_THRESHOLD_MS - 1), false);
    assert.equal(heldLongEnough(0, HOLD_TO_TALK_TAP_THRESHOLD_MS), true);
  });

  it("controller starts after threshold, cancels on release even before listening, stops on blur", (t) => {
    // Keep the timer and elapsed-time clock synchronized; real sleeps can race
    // Date.now() rounding when the threshold callback fires on a busy runner.
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
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
      getDocument: () => ({ querySelector: () => null }),
    });
    t.after(() => ctl.dispose());
    const target = el({ tagName: "DIV" });
    ctl.onKeyDown({ key: " ", repeat: false, target, preventDefault() {} } as unknown as KeyboardEvent);
    t.mock.timers.tick(29);
    assert.deepEqual(log, []);
    t.mock.timers.tick(1);
    assert.deepEqual(log, ["start"]);
    // Release always stops after a real hold (cancels in-flight mint path).
    ctl.onKeyUp({ key: " ", preventDefault() {} } as unknown as KeyboardEvent);
    assert.deepEqual(log, ["start", "stop"]);

    log.length = 0;
    listening = false;
    ctl.onKeyDown({ key: " ", repeat: false, target, preventDefault() {} } as unknown as KeyboardEvent);
    t.mock.timers.tick(30);
    ctl.onBlurOrHide();
    assert.deepEqual(log, ["start", "stop"]);
  });
});
