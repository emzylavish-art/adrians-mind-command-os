import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "../src/components/mind/command-app.tsx"), "utf8");
const chatPane = readFileSync(join(here, "../src/components/mind/chat-pane.tsx"), "utf8");

describe("mobile workspace drawer", () => {
  it("labels the open navigation as a modal and restores focus to its trigger", () => {
    assert.match(app, /role=\{navOpen \? "dialog" : undefined\}/);
    assert.match(app, /aria-modal=\{navOpen \? true : undefined\}/);
    assert.match(app, /if \(navWasOpenRef\.current\)[\s\S]{0,160}trigger\?\.isConnected && trigger\.getClientRects\(\)\.length > 0/);
    assert.match(app, /visibleItem\?\.focus\(\)/);
    assert.match(app, /navTriggerRef\.current = event\.currentTarget/);
  });


  it("closes on Escape and traps keyboard focus while the drawer is open", () => {
    assert.match(app, /if \(event\.key === "Escape"\)[\s\S]{0,180}setNavOpen\(false\)/);
    assert.match(app, /if \(event\.key !== "Tab"\) return/);
    assert.match(app, /event\.shiftKey[\s\S]{0,240}last\.focus\(\)/);
    assert.match(app, /!event\.shiftKey[\s\S]{0,240}first\.focus\(\)/);
  });

  it("focuses close control, locks background scrolling, and closes on backdrop", () => {
    assert.match(app, /navCloseRef\.current\?\.focus\(\)/);
    assert.match(app, /document\.body\.style\.overflow = "hidden"/);
    assert.match(app, /document\.body\.style\.overflow = previous/);
    assert.match(app, /event\.target === event\.currentTarget\) setNavOpen\(false\)/);
    assert.match(app, /onMouseDown=\{closeNavFromBackdrop\}/);
  });

  it("makes the background shell and mobile navigation inert while modal is open", () => {
    assert.match(app, /<main\b[^>]* className="main-stage[^>]*inert=\{navOpen\}/);
    assert.match(app, /<nav inert=\{navOpen\}[^>]*aria-label="Primary"/);
    assert.match(app, /aria-modal=\{navOpen \? true : undefined\}/);
  });

  it("removes key and breakpoint listeners and restores body scrolling on cleanup", () => {
    assert.match(app, /document\.removeEventListener\("keydown", onDrawerKeyDown, true\)/);
    assert.match(app, /desktop\.addEventListener\("change", closeAtDesktop\)/);
    assert.match(app, /desktop\.removeEventListener\("change", closeAtDesktop\)/);
    assert.match(app, /if \(event\.matches\) setNavOpen\(false\)/);
    assert.match(app, /return \(\) => \{\s*document\.body\.style\.overflow = previous;/);
  });
});


describe("composer send guards", () => {
  it("disables Command send with no text or attachments", () => {
    assert.match(app, /disabled=\{busy \|\| ws\.halted \|\| \(!draft\.trim\(\) && pendingImages\.length === 0 && !staged\)\}/);
  });

  it("keeps Stop actionable during generation and guards empty Chat submissions", () => {
    assert.match(chatPane, /type=\{busy \? "button" : "submit"\} onClick=\{busy \? onStop : undefined\}/);
    assert.match(chatPane, /disabled=\{halted \|\| \(!busy && !draft\.trim\(\) && pendingImages\.length === 0 && !stagedName\)\}/);
  });
});

